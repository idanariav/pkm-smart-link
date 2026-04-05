import {
	App,
	Editor,
	SuggestModal,
	TFile,
	CachedMetadata,
	prepareFuzzySearch,
	SearchResult,
} from "obsidian";
import { SmartLinkSettings } from "../settings";
import { getCollection, COLLECTION_MAP } from "../constants";

export class SmartLinkModal extends SuggestModal<TFile> {
	private editor: Editor;
	private settings: SmartLinkSettings;
	private activeCollection = "";
	private index: Map<TFile, string> = new Map();
	private pillBar: HTMLElement | null = null;
	private allFiles: TFile[] = [];

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

	getSuggestions(query: string): TFile[] {
		let candidates = [...this.allFiles];

		// Filter by active collection
		if (this.activeCollection) {
			candidates = candidates.filter(
				(f) => getCollection(f.path) === this.activeCollection
			);
		}

		// Filter by visible collections setting
		const hiddenCollections = this.settings.visibleCollections;
		if (hiddenCollections.length > 0) {
			candidates = candidates.filter((f) => {
				const col = getCollection(f.path);
				return !hiddenCollections.includes(col);
			});
		}

		// If no query, return first N results
		if (!query.trim()) {
			return candidates.slice(0, this.settings.maxResults);
		}

		// Fuzzy search and score
		const matcher = prepareFuzzySearch(query);
		const scored: { file: TFile; score: number }[] = [];

		for (const file of candidates) {
			const composite = this.index.get(file) ?? file.basename;
			const result = matcher(composite);
			if (result) {
				scored.push({ file, score: result.score });
			}
		}

		// Sort by score descending
		scored.sort((a, b) => b.score - a.score);

		return scored.slice(0, this.settings.maxResults).map((s) => s.file);
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		const collection = getCollection(file.path);

		// Top line: title + collection badge
		const topLine = el.createDiv({ cls: "smart-link-result-top" });
		topLine.createEl("span", { text: file.basename, cls: "smart-link-result-title" });

		if (collection) {
			topLine.createEl("span", {
				text: collection,
				cls: "smart-link-result-badge",
			});
		}

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

	onChooseSuggestion(file: TFile, evt: MouseEvent | KeyboardEvent): void {
		// Use frontmatter title if available, otherwise basename
		const cache = this.app.metadataCache.getFileCache(file);
		const title = String(cache?.frontmatter?.title ?? file.basename);

		this.editor.replaceSelection(`[[${title}]]`);
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
				this.updateSuggestions();
			});
		}
	}

	private updateSuggestions(): void {
		// Re-trigger getSuggestions by dispatching input event
		const event = new Event("input", { bubbles: true });
		this.inputEl.dispatchEvent(event);
	}
}
