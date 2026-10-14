import { App, TFile, CachedMetadata } from "obsidian";
import { SmartLinkSettings } from "./settings";
import { getCollection } from "./constants";

export type SuggestionItem =
	| { type: "file"; file: TFile }
	| { type: "uncreated"; name: string };

interface IndexedFields {
	title: string[];
	aliases: string[];
	description: string[];
}

const FIELD_WEIGHT = { title: 3, aliases: 2, description: 1 };
const BACKLINK_WEIGHT = 0.15;
const SCORE_FLOOR_RATIO = 0.4;
const COLLECTION_BOOST: Record<string, number> = { concepts: 1.2, maps: 1.2 };

const tokenize = (text: string): string[] =>
	text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Crude stem: words longer than 5 chars compare on their first 5 letters. */
const stem = (w: string): string => (w.length > 5 ? w.slice(0, 5) : w);

/** True if query token matches a word by prefix, or by shared stem for tokens >= 4 chars. */
function matchesTokens(token: string, words: string[]): boolean {
	const ts = stem(token);
	return words.some(
		(w) => w.startsWith(token) || (token.length >= 4 && w.length >= 4 && stem(w) === ts)
	);
}

/**
 * UI-agnostic engine shared by the SmartLink modal and the inline EditorSuggest.
 * Owns the search index, ranking, link-text resolution and row rendering.
 */
export class LinkEngine {
	private app: App;
	private settings: SmartLinkSettings;
	private index: Map<TFile, IndexedFields> = new Map();
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
			this.index.set(file, this.buildFields(file, cache));
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

	private buildFields(file: TFile, cache: CachedMetadata | null): IndexedFields {
		const fm = cache?.frontmatter ?? {};
		const aliases = Array.isArray(fm.aliases) ? fm.aliases.join(" ") : String(fm.aliases ?? "");
		const title = [file.basename, String(fm.title ?? "")].join(" ");
		return {
			title: tokenize(title),
			aliases: tokenize(aliases),
			description: tokenize(String(fm.description ?? "")),
		};
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

		const tokens = tokenize(query);
		const scored: { item: SuggestionItem; score: number }[] = [];

		for (const file of candidates) {
			const fields = this.index.get(file);
			if (!fields) continue;
			const base = this.scoreFields(tokens, fields);
			if (base <= 0) continue;
			const backlinkBoost = 1 + Math.log1p(this.getBacklinkCount(file)) * BACKLINK_WEIGHT;
			const collectionBoost = COLLECTION_BOOST[getCollection(file.path)] ?? 1;
			scored.push({
				item: { type: "file", file },
				score: base * backlinkBoost * collectionBoost,
			});
		}

		// Uncreated links have only a name: score them as a title-only note
		if (this.settings.showUncreatedLinks) {
			for (const name of this.uncreatedLinks) {
				const base = this.scoreFields(tokens, {
					title: tokenize(name),
					aliases: [],
					description: [],
				});
				if (base > 0) scored.push({ item: { type: "uncreated", name }, score: base });
			}
		}

		scored.sort((a, b) => b.score - a.score);

		// Relevance floor: drop the long tail of weak matches
		const floor = (scored[0]?.score ?? 0) * SCORE_FLOOR_RATIO;
		return scored
			.filter((s) => s.score >= floor)
			.slice(0, this.settings.maxResults)
			.map((s) => s.item);
	}

	/**
	 * Sum, over query tokens, of the best field weight that token matches.
	 * Every token must match somewhere (AND), otherwise the file is excluded.
	 */
	private scoreFields(
		tokens: string[],
		f: IndexedFields
	): number {
		if (tokens.length === 0) return 0;
		let total = 0;
		for (const t of tokens) {
			let best = 0;
			if (matchesTokens(t, f.title)) best = FIELD_WEIGHT.title;
			else if (matchesTokens(t, f.aliases)) best = FIELD_WEIGHT.aliases;
			else if (matchesTokens(t, f.description)) best = FIELD_WEIGHT.description;
			if (best === 0) return 0;
			total += best;
		}
		return total;
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
