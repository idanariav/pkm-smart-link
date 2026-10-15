#!/usr/bin/env node
/**
 * Desktop-only exporter: precomputes the semantic vectors the Smart Link plugin reads on desktop AND mobile.
 *
 *   node tools/export-vectors.mjs [--vault <path>] [--out <vault-relative base>] [--qmd <qmd dist dir>]
 *
 * Writes <out>.json (manifest) + <out>.bin (int8 vectors: items first, then words) into the vault.
 *   items: Content/{Claims,Concepts,Maps} notes (title + aliases + Description, the same text qmd embeds as a
 *          note's "profile" vector) and genuine-claim ghost links
 *          (qvoid's "idea" class, so dates/references/people are skipped)
 *   words: ~5k common English words + every word in those titles, embedded as search queries, so a typed
 *          noun maps to a vector on-device with no model.
 * Vectors come from the model qmd uses (embeddinggemma), truncated to 512 dims and int8-quantized
 * (the size/quality sweet spot in eval). Incremental: unchanged items/words are reused from the last export.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : d; };
const VAULT = arg("vault", path.join(os.homedir(), "GitProjects/Obsidian_Vault"));
const OUT = path.join(VAULT, arg("out", "Scaffolding/Embeddings/smart-link-vectors"));
const QMD = arg("qmd", process.env.QMD_DIST ?? path.join(os.homedir(), "GitProjects/qmd/dist"));
const FOLDERS = ["Content/Claims", "Content/Concepts", "Content/Maps"];
const DIM = 512, SCALE = 127;
const here = path.dirname(fileURLToPath(import.meta.url));
const sha = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);

// ---- collect items ----
const items = [];
for (const folder of FOLDERS) {
	for (const f of fs.readdirSync(path.join(VAULT, folder))) {
		if (!f.endsWith(".md")) continue;
		const title = f.slice(0, -3);
		const fm = matter(fs.readFileSync(path.join(VAULT, folder, f), "utf8")).data;
		const field = (name) => { const k = Object.keys(fm).find((x) => x.toLowerCase() === name); return k ? fm[k] : undefined; };
		const aliases = [].concat(field("aliases") ?? []).map((a) => String(a).trim()).filter(Boolean);
		const desc = field("description") ? String(field("description")).trim() : "";
		items.push({ id: `${folder}/${f}`, title, aliases, desc });
	}
}
try {
	const raw = execFileSync("qvoid", ["query", "--destination", "idea", "--format", "json", "--fields", "target"], { cwd: VAULT, encoding: "utf8", maxBuffer: 1 << 26 });
	for (const line of raw.split("\n")) {
		if (!line.trim().startsWith("{")) continue;
		const t = JSON.parse(line).target;
		items.push({ id: `ghost:${t}`, title: t, aliases: [], desc: "" });
	}
} catch (e) {
	console.warn("qvoid unavailable, skipping ghost links:", e.message.split("\n")[0]);
}

// ---- collect words ----
const words = new Set(fs.readFileSync(path.join(here, "common-words.txt"), "utf8").split("\n").filter(Boolean));
for (const it of items) for (const w of it.title.toLowerCase().match(/[a-z]{3,}/g) ?? []) words.add(w);
const wordList = [...words].sort();

// ---- reuse previous export where unchanged ----
const prev = new Map(); // "i:<id>:<hash>" / "w:<word>" -> int8 slice
if (fs.existsSync(OUT + ".json") && fs.existsSync(OUT + ".bin")) {
	const m = JSON.parse(fs.readFileSync(OUT + ".json", "utf8"));
	if (m.dim === DIM && m.model === MODEL_ID()) {
		const bin = fs.readFileSync(OUT + ".bin");
		const vec = (i) => new Int8Array(bin.buffer, bin.byteOffset + i * DIM, DIM);
		m.items.forEach((it, i) => prev.set(`i:${it.id}:${it.h}`, vec(i)));
		m.words.forEach((w, i) => prev.set(`w:${w}`, vec(m.items.length + i)));
	}
}
function MODEL_ID() { return "embeddinggemma-300M-Q8_0"; }

// ---- embed what's missing ----
const { getDefaultLlamaCpp, formatQueryForEmbedding, formatDocForEmbedding } = await import(path.join(QMD, "llm.js"));
const llm = getDefaultLlamaCpp();
const quantize = (v) => {
	const t = Float64Array.from(v.slice(0, DIM));
	const n = Math.hypot(...t) || 1;
	return Int8Array.from(t, (x) => Math.round((x / n) * SCALE));
};
let embedded = 0;
const out = [];
for (const it of items) {
	// Same text shape as qmd's profile vector ("aliases. description"), which beat title+Description alone in eval.
	it.text = [it.aliases.join(", "), it.desc].filter(Boolean).join(". ");
	it.h = sha(MODEL_ID() + "|" + it.title + "|" + it.text);
	let q = prev.get(`i:${it.id}:${it.h}`);
	if (!q) { q = quantize((await llm.embed(formatDocForEmbedding(it.text, it.title))).embedding); embedded++; }
	out.push(q);
}
for (const w of wordList) {
	let q = prev.get(`w:${w}`);
	if (!q) { q = quantize((await llm.embed(formatQueryForEmbedding(w))).embedding); embedded++; }
	out.push(q);
}

// ---- write ----
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const bin = new Int8Array(out.length * DIM);
out.forEach((q, i) => bin.set(q, i * DIM));
fs.writeFileSync(OUT + ".bin", Buffer.from(bin.buffer));
fs.writeFileSync(OUT + ".json", JSON.stringify({ version: 1, model: MODEL_ID(), dim: DIM, scale: SCALE, items: items.map(({ id, h }) => ({ id, h })), words: wordList }));
console.log(`exported ${items.length} items + ${wordList.length} words (${embedded} newly embedded) -> ${path.relative(VAULT, OUT)}.{json,bin} (${(bin.length / 1e6).toFixed(1)} MB)`);
await llm.dispose?.();
process.exit(0);
