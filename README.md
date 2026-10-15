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

Vectors are built on desktop and read on any device. Without the vectors file the plugin silently falls back to lexical ranking.

```bash
node tools/export-vectors.mjs   # needs qmd (embeddinggemma) and qvoid on the desktop
```

It writes `Scaffolding/Embeddings/smart-link-vectors.{json,bin}` (about 4 MB, int8, 512 dims; path configurable via `--out`/the `vectorsPath` setting):
- **Items**: `Content/{Claims,Concepts,Maps}` notes (title + aliases + Description, the same text qmd embeds as a note's profile vector) and genuine-claim ghost links (qvoid's `idea` class)
- **Words**: about 5k common words (`tools/common-words.txt`) plus every word in those titles. A query becomes a vector by averaging its words' vectors; a query with no known word stays lexical-only

Re-run it after adding notes (it only re-embeds what changed). Notes created on mobile rank lexically until the next export.

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
