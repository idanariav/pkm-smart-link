import { App } from "obsidian";

interface Manifest {
	version: number;
	model: string;
	dim: number;
	scale: number;
	items: { id: string; h: string }[];
	words: string[];
}

/**
 * Precomputed semantic vectors, exported on desktop by tools/export-vectors.mjs and read here on any device.
 * A query becomes a vector by averaging the vectors of its words, so no model runs on-device.
 */
export class VectorStore {
	private dim = 0;
	private scale = 127;
	private itemVecs = new Int8Array(0);
	private wordVecs = new Int8Array(0);
	private itemIndex = new Map<string, number>(); // id -> row
	private wordIndex = new Map<string, number>(); // word -> row
	private stamp = "";

	get ready(): boolean {
		return this.itemIndex.size > 0;
	}

	/** (Re)load from <basePath>.json/.bin if the files changed; leaves the store empty when they're absent. */
	async load(app: App, basePath: string): Promise<void> {
		const adapter = app.vault.adapter;
		const jsonPath = `${basePath}.json`;
		const binPath = `${basePath}.bin`;
		if (!(await adapter.exists(jsonPath)) || !(await adapter.exists(binPath))) {
			this.clear();
			return;
		}
		const stat = await adapter.stat(binPath);
		const stamp = `${stat?.mtime}:${stat?.size}`;
		if (this.ready && stamp === this.stamp) return;

		const manifest = JSON.parse(await adapter.read(jsonPath)) as Manifest;
		const bin = new Int8Array(await adapter.readBinary(binPath));
		const { dim, items, words } = manifest;
		if (bin.length !== (items.length + words.length) * dim) {
			console.warn("Smart Link: vectors file doesn't match its manifest, ignoring");
			this.clear();
			return;
		}
		this.dim = dim;
		this.scale = manifest.scale;
		this.itemVecs = bin.subarray(0, items.length * dim);
		this.wordVecs = bin.subarray(items.length * dim);
		this.itemIndex = new Map(items.map((it, i) => [it.id.toLowerCase(), i]));
		this.wordIndex = new Map(words.map((w, i) => [w, i]));
		this.stamp = stamp;
	}

	private clear(): void {
		this.itemIndex.clear();
		this.wordIndex.clear();
		this.stamp = "";
	}

	/** Unit vector for the query (mean of its known words), or null if none of its words are in the table. */
	queryVector(query: string): Float32Array | null {
		const sum = new Float32Array(this.dim);
		let found = 0;
		for (const w of query.toLowerCase().match(/[a-z]+/g) ?? []) {
			const row = this.wordIndex.get(w);
			if (row === undefined) continue;
			const off = row * this.dim;
			for (let i = 0; i < this.dim; i++) sum[i] += this.wordVecs[off + i];
			found++;
		}
		if (!found) return null;
		const norm = Math.hypot(...sum) || 1;
		for (let i = 0; i < this.dim; i++) sum[i] /= norm;
		return sum;
	}

	/** Cosine similarity between a query vector and an item id (file path or "ghost:<name>"), or null if unknown. */
	similarity(q: Float32Array, id: string): number | null {
		const row = this.itemIndex.get(id.toLowerCase());
		if (row === undefined) return null;
		const off = row * this.dim;
		let dot = 0;
		for (let i = 0; i < this.dim; i++) dot += q[i] * this.itemVecs[off + i];
		return dot / this.scale;
	}
}

/** One store shared by the modal and the inline suggester, so the vectors file is read once. */
export const sharedVectors = new VectorStore();
