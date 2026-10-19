import { App } from "obsidian";

/** Fields shared by the tools' "pkm-vectors" exports (`qmd export`, `qvoid export`). */
interface ExportManifest {
	format: string;
	version: number;
	files?: string[]; // v2 vector chunks, concatenated in order
	dim: number;
	scale: number;
	words: string[];
}
interface QmdManifest extends ExportManifest {
	docs: { path: string }[];
	items: { d: number; seq: number }[]; // seq -1 = profile vector (title + aliases + description)
}
interface QvoidManifest extends ExportManifest {
	items: string[]; // ghost-link targets
}

const WORD_RE = /[a-z]{3,20}/g;

/** One export's vectors: items addressable by id, plus a word table to embed queries with. */
class Space {
	constructor(
		readonly dim: number,
		private readonly scale: number,
		private readonly bin: Int8Array,
		private readonly itemRow: Map<string, number>,
		private readonly wordRow: Map<string, number>
	) {}

	/** Unit vector for the query (mean of its known words), or null if none of its words are in the table. */
	queryVector(query: string): Float32Array | null {
		const sum = new Float32Array(this.dim);
		let found = 0;
		for (const w of query.toLowerCase().match(WORD_RE) ?? []) {
			const row = this.wordRow.get(w);
			if (row === undefined) continue;
			const off = row * this.dim;
			for (let i = 0; i < this.dim; i++) sum[i] += this.bin[off + i];
			found++;
		}
		if (!found) return null;
		const norm = Math.hypot(...sum) || 1;
		for (let i = 0; i < this.dim; i++) sum[i] /= norm;
		return sum;
	}

	similarity(q: Float32Array, id: string): number | null {
		const row = this.itemRow.get(id.toLowerCase());
		if (row === undefined) return null;
		const off = row * this.dim;
		let dot = 0;
		for (let i = 0; i < this.dim; i++) dot += q[i] * this.bin[off + i];
		return dot / this.scale;
	}
}

/** A query embedded in each available space: notes (qmd's model) and ghost links (qvoid's model). */
export interface QueryVectors {
	notes: Float32Array | null;
	ghosts: Float32Array | null;
}

const GHOST_PREFIX = "ghost:";

/**
 * Precomputed semantic vectors, read from the qmd and qvoid exports in the vault
 * (`qmd export` / `qvoid export` on desktop), on any device. Notes and ghost links come from
 * different models, so each has its own word table and its scores are only comparable within it.
 */
export class VectorStore {
	private notes: Space | null = null;
	private ghosts: Space | null = null;
	private stamp = "";

	get ready(): boolean {
		return this.notes !== null || this.ghosts !== null;
	}

	/** (Re)load from `<exportDir>/qmd` and `<exportDir>/qvoid` if they changed; either may be absent. */
	async load(app: App, exportDir: string): Promise<void> {
		const adapter = app.vault.adapter;
		const dirs = { qmd: `${exportDir}/qmd`, qvoid: `${exportDir}/qvoid` };
		const stats = await Promise.all(Object.values(dirs).map((d) => adapter.stat(`${d}/manifest.json`)));
		const stamp = stats.map((s) => `${s?.mtime}:${s?.size}`).join("|");
		if (stamp === this.stamp) return;

		this.notes = await loadSpace<QmdManifest>(app, dirs.qmd, (m) => noteRows(m));
		this.ghosts = await loadSpace<QvoidManifest>(app, dirs.qvoid, (m) =>
			new Map(m.items.map((target, i) => [`${GHOST_PREFIX}${target}`.toLowerCase(), i]))
		);
		// An export whose manifest synced before its vector files didn't load; retry on the next call.
		const complete = [this.notes, this.ghosts].every((space, i) => space !== null || !stats[i]);
		this.stamp = complete ? stamp : "";
	}

	queryVector(query: string): QueryVectors | null {
		const q = { notes: this.notes?.queryVector(query) ?? null, ghosts: this.ghosts?.queryVector(query) ?? null };
		return q.notes || q.ghosts ? q : null;
	}

	/** Cosine similarity between the query and an item id (file path or "ghost:<name>"), or null if unknown.
	 *  Only compare scores of the same kind (notes with notes, ghosts with ghosts). */
	similarity(q: QueryVectors, id: string): number | null {
		const isGhost = id.startsWith(GHOST_PREFIX);
		const space = isGhost ? this.ghosts : this.notes;
		const vec = isGhost ? q.ghosts : q.notes;
		return space && vec ? space.similarity(vec, id) : null;
	}
}

/** Note path → row: its profile vector when it has one, else its first chunk (title-led text). */
function noteRows(m: QmdManifest): Map<string, number> {
	const rows = new Map<string, number>();
	m.items.forEach((item, i) => {
		const path = m.docs[item.d].path.toLowerCase();
		if (item.seq === -1) rows.set(path, i);
		else if (item.seq === 0 && !rows.has(path)) rows.set(path, i);
	});
	return rows;
}

async function loadSpace<M extends ExportManifest>(
	app: App,
	dir: string,
	itemRows: (m: M) => Map<string, number>
): Promise<Space | null> {
	const adapter = app.vault.adapter;
	const manifestPath = `${dir}/manifest.json`;
	if (!(await adapter.exists(manifestPath))) return null;
	const m = JSON.parse(await adapter.read(manifestPath)) as M & { items: unknown[] };
	// v2 splits vectors into chunk `files` (each under Obsidian Sync's 5 MB limit); v1 has one vectors.bin.
	const paths = (m.files ?? ["vectors.bin"]).map((f) => `${dir}/${f}`);
	for (const p of paths) if (!(await adapter.exists(p))) return null;
	const parts = await Promise.all(paths.map((p) => adapter.readBinary(p)));
	const bin = new Int8Array(parts.reduce((n, b) => n + b.byteLength, 0));
	let off = 0;
	for (const b of parts) {
		bin.set(new Int8Array(b), off);
		off += b.byteLength;
	}
	if (m.format !== "pkm-vectors" || (m.version !== 1 && m.version !== 2) || bin.length !== (m.items.length + m.words.length) * m.dim) {
		console.warn(`Smart Link: ${dir} isn't a readable pkm-vectors export, ignoring`);
		return null;
	}
	const wordRow = new Map(m.words.map((w, i) => [w, m.items.length + i]));
	return new Space(m.dim, m.scale, bin, itemRows(m), wordRow);
}

/** One store shared by the modal and the inline suggester, so the exports are read once. */
export const sharedVectors = new VectorStore();
