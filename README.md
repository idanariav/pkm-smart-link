# PKM Smart Link

A filtered, semantically ranked link insertion plugin for Obsidian. Replaces Obsidian's noisy native `[[` linking with a smart modal that ranks results by relevance and lets you filter by content type.

## Features

- **Semantic ranking**: Uses Obsidian's fuzzy search to rank results by relevance, not just alphabetically
- **Collection filtering**: Quickly narrow results by content type (claims, concepts, maps, books, etc.)
- **Mobile compatible**: Works on both desktop and mobile (no subprocess or server required)
- **Lightweight**: Uses only Obsidian's built-in APIs, no external dependencies

## Usage

1. Open any note in editing mode
2. Trigger the "Insert Smart Link" command (Command palette or hotkey)
3. Type a query to search for notes
4. Click a collection pill to filter by content type (optional)
5. Select a result to insert `[[title]]` at your cursor

## Settings

- **Max results**: How many results to show (default: 50)
- **Visible Collections**: Toggle which collections appear as filter pills

## How It Works

The plugin builds a composite search index from each file's filename, frontmatter title, aliases, and description. When you search, it uses Obsidian's `prepareFuzzySearch()` to rank matches by relevance score, then filters by collection if you select one.

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
