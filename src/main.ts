import { Plugin, Editor, EditorSuggest } from "obsidian";
import { SmartLinkSettings, DEFAULT_SETTINGS } from "./settings";
import { SmartLinkSettingTab } from "./settingsTab";
import { SmartLinkModal } from "./views/smartLinkModal";
import { SmartLinkSuggest } from "./views/smartLinkSuggest";

export default class SmartLinkPlugin extends Plugin {
	settings: SmartLinkSettings = DEFAULT_SETTINGS;
	private suggest: SmartLinkSuggest | null = null;
	// The native link suggester we removed, kept so we can restore it.
	private removedNativeSuggest: EditorSuggest<unknown> | null = null;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new SmartLinkSettingTab(this.app, this));

		// Inline [[ suggester
		this.suggest = new SmartLinkSuggest(this.app, this.settings);
		this.registerEditorSuggest(this.suggest);

		this.applyNativeOverride();

		// Command (modal)
		this.addCommand({
			id: "smart-link-insert",
			name: "Insert Smart Link",
			editorCallback: (editor: Editor) => {
				new SmartLinkModal(this.app, editor, this.settings).open();
			},
		});
	}

	onunload() {
		// Always restore Obsidian's native link suggester on unload.
		this.restoreNativeSuggest();
	}

	/** Enable or disable the native [[ override based on the current setting. */
	applyNativeOverride(): void {
		if (this.settings.overrideNativeLinkSuggest) {
			this.removeNativeSuggest();
		} else {
			this.restoreNativeSuggest();
		}
	}

	// Obsidian's built-in link suggester is the first entry of the (private,
	// untyped) editorSuggest.suggests array. We remove/re-insert it directly.
	private getSuggests(): EditorSuggest<unknown>[] | null {
		const manager = (this.app.workspace as unknown as {
			editorSuggest?: { suggests?: EditorSuggest<unknown>[] };
		}).editorSuggest;
		return manager?.suggests ?? null;
	}

	private removeNativeSuggest(): void {
		if (this.removedNativeSuggest) return; // already removed
		try {
			const suggests = this.getSuggests();
			if (suggests && suggests.length > 0) {
				this.removedNativeSuggest = suggests.splice(0, 1)[0];
			}
		} catch (e) {
			console.error("pkm-smart-link: failed to override native link suggester", e);
		}
	}

	private restoreNativeSuggest(): void {
		if (!this.removedNativeSuggest) return;
		try {
			const suggests = this.getSuggests();
			if (suggests && !suggests.includes(this.removedNativeSuggest)) {
				suggests.unshift(this.removedNativeSuggest);
			}
		} catch (e) {
			console.error("pkm-smart-link: failed to restore native link suggester", e);
		} finally {
			this.removedNativeSuggest = null;
		}
	}

	async loadSettings() {
		const loaded = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
