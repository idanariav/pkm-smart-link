import { Plugin, Editor, debounce } from "obsidian";
import { SmartLinkSettings, DEFAULT_SETTINGS } from "./settings";
import { SmartLinkSettingTab } from "./settingsTab";
import { SmartLinkModal } from "./views/smartLinkModal";
import { SmartLinkSuggest } from "./views/smartLinkSuggest";

export default class SmartLinkPlugin extends Plugin {
	settings: SmartLinkSettings = DEFAULT_SETTINGS;
	private suggest: SmartLinkSuggest | null = null;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new SmartLinkSettingTab(this.app, this));

		// Inline [[ suggester
		this.suggest = new SmartLinkSuggest(this.app, this.settings);
		this.registerEditorSuggest(this.suggest);

		// Build the search index off the keystroke hot path: once on startup,
		// then refreshed (debounced) whenever the metadata cache settles. Doing
		// this inside onTrigger blocked the main thread and closed the popup.
		this.app.workspace.onLayoutReady(() => this.suggest?.refreshIndex());
		this.registerEvent(
			this.app.metadataCache.on(
				"resolved",
				debounce(() => this.suggest?.refreshIndex(), 2000, true)
			)
		);

		// Command (modal)
		this.addCommand({
			id: "smart-link-insert",
			name: "Insert Smart Link",
			editorCallback: (editor: Editor) => {
				new SmartLinkModal(this.app, editor, this.settings).open();
			},
		});
	}

	async loadSettings() {
		const loaded = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
