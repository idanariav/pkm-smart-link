import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	TFile,
} from "obsidian";
import { SmartLinkSettings } from "../settings";
import { LinkEngine, SuggestionItem } from "../linkEngine";

/**
 * Inline `[[` autocomplete. Mirrors the SmartLink modal's results, anchored at
 * the cursor, so it can replace Obsidian's native link popup.
 */
export class SmartLinkSuggest extends EditorSuggest<SuggestionItem> {
	private settings: SmartLinkSettings;
	private engine: LinkEngine;
	private isOpen = false;

	constructor(app: App, settings: SmartLinkSettings) {
		super(app);
		this.settings = settings;
		this.engine = new LinkEngine(app, settings);
	}

	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
		_file: TFile | null
	): EditorSuggestTriggerInfo | null {
		const beforeCursor = editor.getLine(cursor.line).slice(0, cursor.ch);
		// Match the configurable trigger prefix followed by the query, ending at
		// the cursor. An empty prefix would match everything, so bail out.
		const prefix = this.settings.triggerPrefix;
		if (!prefix) {
			this.isOpen = false;
			return null;
		}
		const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const match = beforeCursor.match(new RegExp(escaped + "([^\\]\\n]*)$"));
		if (!match) {
			this.isOpen = false;
			return null;
		}

		// Rebuild the index once when the popup opens (not on every keystroke).
		if (!this.isOpen) {
			this.engine.buildIndex();
			this.isOpen = true;
		}

		return {
			start: { line: cursor.line, ch: match.index ?? 0 },
			end: cursor,
			query: match[1],
		};
	}

	getSuggestions(context: EditorSuggestContext): SuggestionItem[] {
		return this.engine.getSuggestions(context.query, this.settings.defaultCollection);
	}

	renderSuggestion(item: SuggestionItem, el: HTMLElement): void {
		this.engine.renderItem(item, el);
	}

	selectSuggestion(item: SuggestionItem, _evt: MouseEvent | KeyboardEvent): void {
		const context = this.context;
		if (!context) return;

		const editor = context.editor;
		const replacement = `[[${this.engine.getLinkText(item)}]]`;

		// Overwrite any auto-paired closing brackets that follow the cursor so we
		// don't leave stray `]`s behind. A prefix ending in `[` auto-pairs one `]`
		// per trailing `[`, so consume up to that many consecutive `]`.
		let end = context.end;
		const trailingOpen = this.settings.triggerPrefix.match(/\[+$/)?.[0].length ?? 0;
		if (trailingOpen > 0) {
			const after = editor.getLine(context.end.line).slice(context.end.ch, context.end.ch + trailingOpen);
			const closers = after.match(/^\]+/)?.[0].length ?? 0;
			if (closers > 0) {
				end = { line: context.end.line, ch: context.end.ch + closers };
			}
		}

		editor.replaceRange(replacement, context.start, end);
		editor.setCursor({
			line: context.start.line,
			ch: context.start.ch + replacement.length,
		});
		this.close();
	}
}
