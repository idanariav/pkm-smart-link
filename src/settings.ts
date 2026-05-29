export interface SmartLinkSettings {
	visibleCollections: string[]; // empty = show all
	maxResults: number;
	defaultCollection: string; // empty = "All"
	showUncreatedLinks: boolean;
	hideImageLinks: boolean;
	overrideNativeLinkSuggest: boolean; // replace Obsidian's [[ popup with the inline Smart Link popup
}

export const DEFAULT_SETTINGS: SmartLinkSettings = {
	visibleCollections: [],
	maxResults: 50,
	defaultCollection: "",
	showUncreatedLinks: true,
	hideImageLinks: true,
	overrideNativeLinkSuggest: true,
};
