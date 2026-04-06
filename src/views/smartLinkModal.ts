import {
	App,
	Editor,
	SuggestModal,
	TFile,
	CachedMetadata,
	prepareFuzzySearch,
} from "obsidian";
import { SmartLinkSettings } from "../settings";
import { getCollection, COLLECTION_MAP } from "../constants";

type SuggestionItem =
	| { type: "file"; file: TFile }
	| { type: "uncreated"; name: string };

export class SmartLinkModal extends SuggestModal<SuggestionItem> {
	private editor: Editor;
	private settings: SmartLinkSettings;
	private activeCollection = "";
	private index: Map<TFile, string> = new Map();
	private pillBar: HTMLElement | null = null;
	private allFiles: TFile[] = [];
	private uncreatedLinks: string[] = [];

	constructor(app: App, editor: Editor, settings: SmartLinkSettings) {
		super(app);
		this.editor = editor;
		this.settings = settings;
		this.modalEl.addClass("smart-link-modal");
	}

	onOpen(): void {
		// Build composite search index once
		this.allFiles = this.app.vault.getMarkdownFiles();

		for (const file of this.allFiles) {
			const cache = this.app.metadataCache.getFileCache(file);
			const composite = this.buildCompositeString(file, cache);
			this.index.set(file, composite);
		}

		// Collect uncreated (unresolved) links
		if (this.settings.showUncreatedLinks) {
			const imageExts = /\.(png|jpg|webp)$/i;
			const seen = new Set<string>();
			const unresolved = this.app.metadataCache.unresolvedLinks;
			for (const links of Object.values(unresolved)) {
				for (const linkName of Object.keys(links)) {
					if (this.settings.hideImageLinks && imageExts.test(linkName)) continue;
					seen.add(linkName);
				}
			}
			this.uncreatedLinks = Array.from(seen).sort();
		}

		// Set active collection to default (if configured)
		this.activeCollection = this.settings.defaultCollection;

		// Render collection pills above input
		this.pillBar = this.modalEl.createDiv({ cls: "smart-link-pill-bar" });
		this.modalEl.prepend(this.pillBar);
		this.renderPills();

		// Call parent onOpen to set up input field
		super.onOpen();

		// Focus input after it's ready
		setTimeout(() => this.inputEl.focus(), 10);
	}

	private buildCompositeString(file: TFile, cache: CachedMetadata | null): string {
		const fm = cache?.frontmatter ?? {};
		const parts = [
			file.basename,
			String(fm.title ?? "").trim(),
			Array.isArray(fm.aliases) ? fm.aliases.join(" ") : String(fm.aliases ?? "").trim(),
			String(fm.description ?? "").trim(),
		];
		return parts.filter(Boolean).join(" | ");
	}

	private getBacklinkCount(file: TFile): number {
		const resolved = this.app.metadataCache.resolvedLinks;
		let count = 0;
		for (const links of Object.values(resolved)) {
			if (file.path in links) count++;
		}
		return count;
	}

	getSuggestions(query: string): SuggestionItem[] {
		let candidates = [...this.allFiles];

		// Filter by active collection
		if (this.activeCollection) {
			candidates = candidates.filter(
				(f) => getCollection(f.path) === this.activeCollection
			);
		} else {
			// Only apply visible collections filter when showing "All" (no specific collection selected)
			const visibleCollections = this.settings.visibleCollections;
			if (visibleCollections.length > 0) {
				candidates = candidates.filter((f) => {
					const col = getCollection(f.path);
					return visibleCollections.includes(col);
				});
			}
		}

		// If no query, return first N results (files first, then uncreated)
		if (!query.trim()) {
			const fileItems: SuggestionItem[] = candidates
				.slice(0, this.settings.maxResults)
				.map((f) => ({ type: "file", file: f }));

			if (this.settings.showUncreatedLinks) {
				const remaining = this.settings.maxResults - fileItems.length;
				const uncreatedItems: SuggestionItem[] = this.uncreatedLinks
					.slice(0, remaining)
					.map((name) => ({ type: "uncreated", name }));
				return [...fileItems, ...uncreatedItems];
			}
			return fileItems;
		}

		// Fuzzy search files
		const matcher = prepareFuzzySearch(query);
		const scored: { item: SuggestionItem; score: number }[] = [];

		for (const file of candidates) {
			const composite = this.index.get(file) ?? file.basename;
			const result = matcher(composite);
			if (result) {
				scored.push({ item: { type: "file", file }, score: result.score });
			}
		}

		// Fuzzy search uncreated links (not filtered by collection)
		if (this.settings.showUncreatedLinks) {
			for (const name of this.uncreatedLinks) {
				const result = matcher(name);
				if (result) {
					scored.push({ item: { type: "uncreated", name }, score: result.score });
				}
			}
		}

		// Sort by score descending
		scored.sort((a, b) => b.score - a.score);

		return scored.slice(0, this.settings.maxResults).map((s) => s.item);
	}

	renderSuggestion(item: SuggestionItem, el: HTMLElement): void {
		if (item.type === "uncreated") {
			el.addClass("smart-link-result--uncreated");
			const topLine = el.createDiv({ cls: "smart-link-result-top" });
			topLine.createEl("span", { text: item.name, cls: "smart-link-result-title" });
			topLine.createEl("span", {
				text: "uncreated",
				cls: "smart-link-result-badge smart-link-result-badge--uncreated",
			});
			return;
		}

		const { file } = item;
		const collection = getCollection(file.path);
		const backlinks = this.getBacklinkCount(file);

		// Top line: title + collection badge + backlink count
		const topLine = el.createDiv({ cls: "smart-link-result-top" });
		topLine.createEl("span", { text: file.basename, cls: "smart-link-result-title" });

		if (collection) {
			topLine.createEl("span", {
				text: collection,
				cls: "smart-link-result-badge",
			});
		}

		topLine.createEl("span", {
			text: `↩ ${backlinks}`,
			cls: "smart-link-result-backlinks",
		});

		// Description snippet if available
		const cache = this.app.metadataCache.getFileCache(file);
		const desc = cache?.frontmatter?.description;
		if (desc) {
			el.createEl("p", {
				text: String(desc).slice(0, 100),
				cls: "smart-link-result-snippet",
			});
		}
	}

	onChooseSuggestion(item: SuggestionItem, evt: MouseEvent | KeyboardEvent): void {
		const name =
			item.type === "file"
				? String(
					this.app.metadataCache.getFileCache(item.file)?.frontmatter?.title ??
					item.file.basename
				)
				: item.name;
		this.editor.replaceSelection(`[[${name}]]`);
	}

	private renderPills(): void {
		if (!this.pillBar) return;

		this.pillBar.empty();

		// Build list of pills to show
		const visibleCollections = this.settings.visibleCollections;
		const allCollections = ["", ...Object.values(COLLECTION_MAP)];
		const pills = visibleCollections.length === 0
			? allCollections
			: ["", ...visibleCollections];

		for (const col of pills) {
			const label = col === "" ? "All" : col;
			const isActive = col === this.activeCollection;
			const btn = this.pillBar.createEl("button", {
				text: label,
				cls:
					"smart-link-pill" +
					(isActive ? " smart-link-pill--active" : ""),
			});

			btn.addEventListener("click", (e) => {
				e.preventDefault();
				this.activeCollection = col;
				this.renderPills();
				// Trigger re-render of suggestions
				this.refreshSuggestions();
			});
		}
	}

	private refreshSuggestions(): void {
		// Re-trigger getSuggestions by dispatching input event asynchronously
		setTimeout(() => {
			const event = new Event("input", { bubbles: true });
			this.inputEl.dispatchEvent(event);
		}, 0);
	}
}
