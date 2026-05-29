import { App, Editor, SuggestModal } from "obsidian";
import { SmartLinkSettings } from "../settings";
import { COLLECTION_MAP } from "../constants";
import { LinkEngine, SuggestionItem } from "../linkEngine";

export class SmartLinkModal extends SuggestModal<SuggestionItem> {
	private editor: Editor;
	private settings: SmartLinkSettings;
	private engine: LinkEngine;
	private activeCollection = "";
	private pillBar: HTMLElement | null = null;

	constructor(app: App, editor: Editor, settings: SmartLinkSettings) {
		super(app);
		this.editor = editor;
		this.settings = settings;
		this.engine = new LinkEngine(app, settings);
		this.modalEl.addClass("smart-link-modal");
	}

	onOpen(): void {
		// Build composite search index once
		this.engine.buildIndex();

		// Set active collection to default (if configured)
		this.activeCollection = this.settings.defaultCollection;

		// Render collection pills above input
		this.pillBar = this.modalEl.createDiv({ cls: "smart-link-pill-bar" });
		this.modalEl.prepend(this.pillBar);
		this.renderPills();

		// Call parent onOpen to set up input field
		super.onOpen();

		// Focus input after it's ready
		setTimeout(() => this.inputEl.focus(), 10);
	}

	getSuggestions(query: string): SuggestionItem[] {
		return this.engine.getSuggestions(query, this.activeCollection);
	}

	renderSuggestion(item: SuggestionItem, el: HTMLElement): void {
		this.engine.renderItem(item, el);
	}

	onChooseSuggestion(item: SuggestionItem): void {
		this.editor.replaceSelection(`[[${this.engine.getLinkText(item)}]]`);
	}

	private renderPills(): void {
		if (!this.pillBar) return;

		this.pillBar.empty();

		// Build list of pills to show
		const visibleCollections = this.settings.visibleCollections;
		const allCollections = ["", ...Object.values(COLLECTION_MAP)];
		const pills = visibleCollections.length === 0
			? allCollections
			: ["", ...visibleCollections];

		for (const col of pills) {
			const label = col === "" ? "All" : col;
			const isActive = col === this.activeCollection;
			const btn = this.pillBar.createEl("button", {
				text: label,
				cls:
					"smart-link-pill" +
					(isActive ? " smart-link-pill--active" : ""),
			});

			btn.addEventListener("click", (e: MouseEvent) => {
				e.preventDefault();
				this.activeCollection = col;
				this.renderPills();
				// Trigger re-render of suggestions
				this.refreshSuggestions();
			});
		}
	}

	private refreshSuggestions(): void {
		// Re-trigger getSuggestions by dispatching input event asynchronously
		setTimeout(() => {
			const event = new Event("input", { bubbles: true });
			this.inputEl.dispatchEvent(event);
		}, 0);
	}
}
