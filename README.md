# PKM Smart Link

A filtered, semantically ranked link insertion plugin for Obsidian. Replaces Obsidian's noisy native `[[` linking with a smart modal that ranks results by relevance and lets you filter by content type.

## Features

- **Ranked results**: Word and stem matching across title, aliases and description (exact word > prefix > stem), boosted by backlinks, with graph expansion (a matching concept/map also surfaces the notes it links to)
- **Semantic ranking (optional)**: Blends in similarity from precomputed vectors, so "burnout" also finds notes about exhaustion and overload. Works on mobile: only vault files are read, no model runs on-device
- **Collection filtering**: Quickly narrow results by content type (claims, concepts, maps, books, etc.)
- **Mobile compatible**: Works on both desktop and mobile (no subprocess or server required)
- **Lightweight**: Obsidian's built-in APIs plus a small stemmer; no server or model needed at search time

## Usage

1. Open any note in editing mode
2. Trigger the "Insert Smart Link" command (Command palette or hotkey)
3. Type a query to search for notes
4. Click a collection pill to filter by content type (optional)
5. Select a result to insert `[[title]]` at your cursor

## Settings

- **Max results**: How many results to show (default: 50)
- **Visible Collections**: Toggle which collections appear as filter pills

## Semantic vectors

Vectors are built on desktop by the qmd and qvoid tools and read on any device. Without them the plugin silently falls back to lexical ranking.

```bash
qmd export --out <vault>/Scaffolding/Embeddings/qmd       # notes (embeddinggemma, 512 dims, int8)
qvoid export --out <vault>/Scaffolding/Embeddings/qvoid   # ghost links (bge-small, 384 dims, int8)
```

The plugin reads both from the folder in the `exportDir` setting (default `Scaffolding/Embeddings`). The format is `pkm-vectors` v2 (vectors split into chunk files under 5 MB, for Obsidian Sync; v1 single-file exports are still read); see qmd's `docs/EXPORT.md` and qvoid's `docs/EXPORT.md`.
- **Notes**: each note's qmd profile vector (title + aliases + description), or its first chunk when it has no aliases/description
- **Ghost links**: qvoid's embedded targets (its `idea` class)
- **Words**: each export has its own word table (common English words plus the vault's frequent words). A query becomes one vector per export, the mean of its words' vectors. A query with no known word stays lexical-only

Notes and ghost links come from different models, so each list's similarities are scaled by its own best match before they're merged. With `export.path` / `[export] path` set in the tools' configs, `qmd embed` and `qvoid index`/`embed` re-export automatically. Notes created on mobile rank lexically until the next export.

Switching from the old `tools/export-vectors.mjs` exporter on the eval sets: `queries.json` recall@10 went 0.394 → 0.417 and MRR 0.755 → 0.865; `nouns.json` recall@10 went 0.849 → 0.876, with MRR 0.978 → 0.967.

## Evaluation

`eval/` holds query sets and a harness that scores the installed plugin through `obsidian eval`: `eval/deploy.sh` builds and reloads, then `python3 -I eval/run_eval.py [--set nouns.json] [--tuning '{"vectorWeight":0}']`. `queries.json` was built from concept clusters and pooled judgments; `nouns.json` is a draft of single-noun recall queries for the owner to correct.

## How It Works

The plugin indexes each file's filename, frontmatter title, aliases and description as Porter-stemmed words. A query word scores by its best field (title 3, aliases 2, description 1), scaled by match quality, backlinks and collection; weak matches below 40% of the top score are dropped. Concepts/maps that match pull in their linked notes, and, when vectors exist, the lexical ranking is fused (reciprocal rank) with the nearest vectors.

Files are automatically classified into collections based on their folder path:
- `Content/Claims/` → "claims"
- `Content/Concepts/` → "concepts"
- `Content/Maps/` → "maps"
- `Sources/Books/` → "books"
- And more...

## Development

```bash
npm install
npm run dev      # Watch mode
npm run build    # Production build
```

## License

MIT
