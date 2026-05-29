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
		// Match an open, unclosed `[[` ending at the cursor.
		const match = beforeCursor.match(/\[\[([^\]\n]*)$/);
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

		// Overwrite the auto-paired closing `]]` if it follows the cursor,
		// so we don't end up with `[[name]]]]`.
		let end = context.end;
		const after = editor.getLine(context.end.line).slice(context.end.ch, context.end.ch + 2);
		if (after === "]]") {
			end = { line: context.end.line, ch: context.end.ch + 2 };
		}

		editor.replaceRange(replacement, context.start, end);
		editor.setCursor({
			line: context.start.line,
			ch: context.start.ch + replacement.length,
		});
		this.close();
	}
}
