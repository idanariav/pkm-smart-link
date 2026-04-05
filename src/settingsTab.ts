import { App, PluginSettingTab, Setting } from "obsidian";
import SmartLinkPlugin from "./main";
import { ALL_COLLECTIONS } from "./constants";

export class SmartLinkSettingTab extends PluginSettingTab {
	plugin: SmartLinkPlugin;

	constructor(app: App, plugin: SmartLinkPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Smart Link Settings" });

		new Setting(containerEl)
			.setName("Max results")
			.setDesc("Maximum number of results to show in the modal")
			.addSlider((slider) =>
				slider
					.setLimits(10, 100, 5)
					.setValue(this.plugin.settings.maxResults)
					.onChange(async (value) => {
						this.plugin.settings.maxResults = value;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", { text: "Visible Collections" });
		containerEl.createEl("p", { text: "Uncheck to hide collections from the filter pills" });

		for (const collection of ALL_COLLECTIONS) {
			new Setting(containerEl)
				.setName(collection)
				.addToggle((toggle) =>
					toggle
						.setValue(!this.plugin.settings.visibleCollections.includes(collection))
						.onChange(async (value) => {
							const idx = this.plugin.settings.visibleCollections.indexOf(collection);
							if (!value && idx === -1) {
								this.plugin.settings.visibleCollections.push(collection);
							} else if (value && idx !== -1) {
								this.plugin.settings.visibleCollections.splice(idx, 1);
							}
							await this.plugin.saveSettings();
						})
				);
		}
	}
}
