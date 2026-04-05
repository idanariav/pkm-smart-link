import { Plugin, Editor } from "obsidian";
import { SmartLinkSettings, DEFAULT_SETTINGS } from "./settings";
import { SmartLinkSettingTab } from "./settingsTab";
import { SmartLinkModal } from "./views/smartLinkModal";

export default class SmartLinkPlugin extends Plugin {
	settings: SmartLinkSettings = DEFAULT_SETTINGS;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new SmartLinkSettingTab(this.app, this));

		// Register command
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
