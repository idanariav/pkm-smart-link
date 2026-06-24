import { App, TFile, CachedMetadata, prepareFuzzySearch } from "obsidian";
import { SmartLinkSettings } from "./settings";
import { getCollection } from "./constants";

export type SuggestionItem =
	| { type: "file"; file: TFile }
	| { type: "uncreated"; name: string };

/**
 * UI-agnostic engine shared by the SmartLink modal and the inline EditorSuggest.
 * Owns the search index, ranking, link-text resolution and row rendering.
 */
export class LinkEngine {
	private app: App;
	private settings: SmartLinkSettings;
	private index: Map<TFile, string> = new Map();
	private allFiles: TFile[] = [];
	private uncreatedLinks: string[] = [];
	private backlinkCounts: Map<string, number> = new Map();

	constructor(app: App, settings: SmartLinkSettings) {
		this.app = app;
		this.settings = settings;
	}

	/** Build the composite search index and uncreated-links list. Call once per open. */
	buildIndex(): void {
		this.allFiles = this.app.vault.getMarkdownFiles();
		this.index.clear();

		for (const file of this.allFiles) {
			const cache = this.app.metadataCache.getFileCache(file);
			this.index.set(file, this.buildCompositeString(file, cache));
		}

		// Precompute backlink counts once (instead of rescanning resolvedLinks
		// per row at render time, which is O(files) per suggestion).
		this.backlinkCounts.clear();
		const resolved = this.app.metadataCache.resolvedLinks;
		for (const links of Object.values(resolved)) {
			for (const targetPath of Object.keys(links)) {
				this.backlinkCounts.set(
					targetPath,
					(this.backlinkCounts.get(targetPath) ?? 0) + 1
				);
			}
		}

		this.uncreatedLinks = [];
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

	getBacklinkCount(file: TFile): number {
		return this.backlinkCounts.get(file.path) ?? 0;
	}

	getSuggestions(query: string, activeCollection: string): SuggestionItem[] {
		let candidates = [...this.allFiles];

		// Filter by active collection
		if (activeCollection) {
			candidates = candidates.filter(
				(f) => getCollection(f.path) === activeCollection
			);
		} else {
			// Only apply visible collections filter when showing "All"
			const visibleCollections = this.settings.visibleCollections;
			if (visibleCollections.length > 0) {
				candidates = candidates.filter((f) =>
					visibleCollections.includes(getCollection(f.path))
				);
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

		scored.sort((a, b) => b.score - a.score);

		return scored.slice(0, this.settings.maxResults).map((s) => s.item);
	}

	/** Resolve the text to insert inside [[...]] for a suggestion. */
	getLinkText(item: SuggestionItem): string {
		return item.type === "file"
			? String(
					this.app.metadataCache.getFileCache(item.file)?.frontmatter?.title ??
						item.file.basename
			  )
			: item.name;
	}

	/** Render a single suggestion row. Shared by modal and inline popup. */
	renderItem(item: SuggestionItem, el: HTMLElement): void {
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

		const cache = this.app.metadataCache.getFileCache(file);
		const desc = cache?.frontmatter?.description;
		if (desc) {
			el.createEl("p", {
				text: String(desc).slice(0, 100),
				cls: "smart-link-result-snippet",
			});
		}
	}
}
