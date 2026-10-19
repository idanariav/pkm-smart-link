import { App, TFile, CachedMetadata } from "obsidian";
import { stemmer } from "stemmer";
import { SmartLinkSettings } from "./settings";
import { getCollection } from "./constants";
import { sharedVectors } from "./vectors";

export type SuggestionItem =
	| { type: "file"; file: TFile }
	| { type: "uncreated"; name: string };

/** Lowercased words plus their Porter stems, kept in parallel so exact words can outrank stem-only matches. */
interface Words {
	raw: string[];
	stem: string[];
}

interface IndexedFields {
	title: Words;
	aliases: Words;
	description: Words;
}

export interface Tuning {
	fieldWeight: { title: number; aliases: number; description: number };
	backlinkWeight: number;
	/** Drop results scoring below this fraction of the top score (0 = keep all). */
	scoreFloorRatio: number;
	/** Pull in notes linked to matching concepts/maps (0 = off), as a fraction of the seed's score. */
	expandFactor: number;
	collectionBoost: Record<string, number>;
	/** Weight of the semantic ranking in rank fusion with the lexical one (0 = off). */
	vectorWeight: number;
	/** Semantic candidates kept: the K most similar to the query... */
	vectorTopK: number;
	/** ...whose similarity is at least this fraction of the best one. */
	vectorMinRatio: number;
}

export const DEFAULT_TUNING: Tuning = {
	fieldWeight: { title: 3, aliases: 2, description: 1 },
	backlinkWeight: 0.15,
	scoreFloorRatio: 0.4,
	expandFactor: 0.6,
	collectionBoost: { concepts: 1.2, maps: 1.2 },
	vectorWeight: 0.6,
	vectorTopK: 10,
	vectorMinRatio: 0,
};

const RRF_K = 60;

const HUB_COLLECTIONS = new Set(["concepts", "maps"]);

const tokenize = (text: string): Words => {
	const raw = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
	return { raw, stem: raw.map(stemmer) };
};

/** How well one query word matches a field: exact word > prefix (partial typing) > shared stem. */
const EXACT = 1;
const PREFIX = 0.85;
const STEM = 0.5;
function matchQuality(raw: string, stem: string, words: Words): number {
	let best = 0;
	for (let i = 0; i < words.raw.length; i++) {
		const w = words.raw[i];
		if (w === raw) return EXACT;
		if (raw.length >= 3 && w.startsWith(raw)) best = Math.max(best, PREFIX);
		else if (words.stem[i] === stem) best = Math.max(best, STEM);
	}
	return best;
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
	private neighbors: Map<string, Set<string>> = new Map();
	private filesByPath: Map<string, TFile> = new Map();
	private vectors = sharedVectors;

	constructor(app: App, settings: SmartLinkSettings) {
		this.app = app;
		this.settings = settings;
	}

	/** Load/refresh the precomputed semantic vectors. Safe to call repeatedly; no-op if the file is unchanged. */
	async loadVectors(): Promise<void> {
		if (!this.settings.useVectors) return;
		try {
			await this.vectors.load(this.app, this.settings.exportDir);
		} catch (e) {
			console.warn("Smart Link: could not load vectors", e);
		}
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

		// Undirected link graph over resolved links, used for query expansion
		this.neighbors.clear();
		this.filesByPath = new Map(this.allFiles.map((f) => [f.path, f]));
		const addEdge = (a: string, b: string) => {
			if (!this.neighbors.has(a)) this.neighbors.set(a, new Set());
			this.neighbors.get(a)!.add(b);
		};
		for (const [src, links] of Object.entries(resolved)) {
			for (const dst of Object.keys(links)) {
				addEdge(src, dst);
				addEdge(dst, src);
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

	getSuggestions(
		query: string,
		activeCollection: string,
		tuning: Tuning = DEFAULT_TUNING
	): SuggestionItem[] {
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
		if (tokens.raw.length === 0) return [];
		const scored: { item: SuggestionItem; score: number }[] = [];

		for (const file of candidates) {
			const score = this.scoreFile(file, tokens, tuning);
			if (score > 0) scored.push({ item: { type: "file", file }, score });
		}

		if (tuning.expandFactor > 0) this.expandViaHubs(scored, candidates, tokens, tuning);

		// Uncreated links have only a name: score them as a title-only note
		if (this.settings.showUncreatedLinks) {
			for (const name of this.uncreatedLinks) {
				const base = this.scoreFields(tokens, {
					title: tokenize(name),
					aliases: { raw: [], stem: [] },
					description: { raw: [], stem: [] },
				}, tuning.fieldWeight);
				if (base > 0) scored.push({ item: { type: "uncreated", name }, score: base });
			}
		}

		scored.sort((a, b) => b.score - a.score);

		// Relevance floor: drop the long tail of weak matches
		const floor = (scored[0]?.score ?? 0) * tuning.scoreFloorRatio;
		const lexical = scored.filter((s) => s.score >= floor);

		const ranked = this.fuseWithVectors(query, candidates, lexical, tuning);
		return ranked.slice(0, this.settings.maxResults);
	}

	/**
	 * Reciprocal-rank fusion of the lexical ranking with a semantic one (nearest precomputed vectors to the
	 * query's word vector), so "burnout" also surfaces notes about exhaustion that never use the word.
	 * Falls back to the lexical ranking alone when vectors are off, missing, or the query has no known word.
	 */
	private fuseWithVectors(
		query: string,
		candidates: TFile[],
		lexical: { item: SuggestionItem }[],
		tuning: Tuning
	): SuggestionItem[] {
		const lexItems = lexical.map((s) => s.item);
		if (!this.settings.useVectors || tuning.vectorWeight <= 0 || !this.vectors.ready) return lexItems;
		const q = this.vectors.queryVector(query);
		if (!q) return lexItems;

		const noteSims: { item: SuggestionItem; sim: number }[] = [];
		for (const file of candidates) {
			const sim = this.vectors.similarity(q, file.path);
			if (sim !== null) noteSims.push({ item: { type: "file", file }, sim });
		}
		const ghostSims: { item: SuggestionItem; sim: number }[] = [];
		if (this.settings.showUncreatedLinks) {
			for (const name of this.uncreatedLinks) {
				const sim = this.vectors.similarity(q, `ghost:${name}`);
				if (sim !== null) ghostSims.push({ item: { type: "uncreated", name }, sim });
			}
		}
		// Notes and ghost links are scored by different models, so scale each by its own best
		// match before merging; raw cosines from the two aren't comparable.
		const relative = (list: { item: SuggestionItem; sim: number }[]) => {
			const top = Math.max(...list.map((s) => s.sim));
			return list.map((s) => ({ item: s.item, sim: s.sim / top }));
		};
		const sims = [...relative(noteSims), ...relative(ghostSims)].sort((a, b) => b.sim - a.sim);
		const best = sims[0]?.sim ?? 0;
		const semantic = sims
			.slice(0, tuning.vectorTopK)
			.filter((s) => s.sim >= best * tuning.vectorMinRatio)
			.map((s) => s.item);

		const key = (i: SuggestionItem) => (i.type === "file" ? i.file.path : `ghost:${i.name}`);
		const fused = new Map<string, { item: SuggestionItem; score: number }>();
		const add = (items: SuggestionItem[], weight: number) =>
			items.forEach((item, rank) => {
				const e = fused.get(key(item)) ?? { item, score: 0 };
				e.score += weight / (RRF_K + rank + 1);
				fused.set(key(item), e);
			});
		add(lexItems, 1);
		add(semantic, tuning.vectorWeight);
		return [...fused.values()].sort((a, b) => b.score - a.score).map((e) => e.item);
	}

	/**
	 * Graph expansion: a concept/map that matches the query pulls in the notes it
	 * links to (and that link to it) at a discount, so "innovation" also surfaces
	 * the claims under the "Creative Ideation and Innovation" concept.
	 */
	private expandViaHubs(
		scored: { item: SuggestionItem; score: number }[],
		candidates: TFile[],
		tokens: Words,
		tuning: Tuning
	): void {
		const allowed = new Set(candidates.map((f) => f.path));
		const direct = new Set<string>();
		for (const s of scored) if (s.item.type === "file") direct.add(s.item.file.path);

		// Hubs seed the expansion even when the collection filter hides them from results
		const added = new Map<string, number>();
		for (const hub of this.allFiles) {
			if (!HUB_COLLECTIONS.has(getCollection(hub.path))) continue;
			const seedScore = this.scoreFile(hub, tokens, tuning);
			if (seedScore <= 0) continue;
			for (const n of this.neighbors.get(hub.path) ?? []) {
				if (direct.has(n) || !allowed.has(n)) continue;
				const score = seedScore * tuning.expandFactor;
				if (score > (added.get(n) ?? 0)) added.set(n, score);
			}
		}
		for (const [path, score] of added) {
			const file = this.filesByPath.get(path);
			if (file) scored.push({ item: { type: "file", file }, score });
		}
	}

	/** Weighted field score for one file, boosted by backlinks and collection. 0 = no match. */
	private scoreFile(file: TFile, tokens: Words, tuning: Tuning): number {
		const fields = this.index.get(file);
		if (!fields) return 0;
		const base = this.scoreFields(tokens, fields, tuning.fieldWeight);
		if (base <= 0) return 0;
		const backlinkBoost = 1 + Math.log1p(this.getBacklinkCount(file)) * tuning.backlinkWeight;
		const collectionBoost = tuning.collectionBoost[getCollection(file.path)] ?? 1;
		return base * backlinkBoost * collectionBoost;
	}

	/**
	 * Sum, over query tokens, of the best field weight that token matches.
	 * Every token must match somewhere (AND), otherwise the file is excluded.
	 */
	private scoreFields(tokens: Words, f: IndexedFields, weight: Tuning["fieldWeight"]): number {
		if (tokens.raw.length === 0) return 0;
		let total = 0;
		for (let i = 0; i < tokens.raw.length; i++) {
			const r = tokens.raw[i];
			const st = tokens.stem[i];
			const best = Math.max(
				weight.title * matchQuality(r, st, f.title),
				weight.aliases * matchQuality(r, st, f.aliases),
				weight.description * matchQuality(r, st, f.description)
			);
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
	/** Rendered with Obsidian's own suggestion markup (`mod-complex`), so it matches native link suggestions and wraps long titles. */
	renderItem(item: SuggestionItem, el: HTMLElement): void {
		el.addClass("mod-complex", "smart-link-result");
		const content = el.createDiv({ cls: "suggestion-content" });
		const aux = el.createDiv({ cls: "suggestion-aux" });

		if (item.type === "uncreated") {
			el.addClass("smart-link-result--uncreated");
			content.createDiv({ text: item.name, cls: "suggestion-title" });
			aux.createSpan({ text: "uncreated", cls: "suggestion-flair" });
			return;
		}

		const { file } = item;
		content.createDiv({ text: file.basename, cls: "suggestion-title" });

		const desc = this.app.metadataCache.getFileCache(file)?.frontmatter?.description;
		if (desc) content.createDiv({ text: String(desc).slice(0, 100), cls: "suggestion-note" });

		const collection = getCollection(file.path);
		if (collection) aux.createSpan({ text: collection, cls: "suggestion-flair" });
		aux.createSpan({ text: `↩ ${this.getBacklinkCount(file)}`, cls: "smart-link-result-backlinks" });
	}
}
