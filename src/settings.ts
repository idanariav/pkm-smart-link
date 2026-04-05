export interface SmartLinkSettings {
	visibleCollections: string[]; // empty = show all
	maxResults: number;
	defaultCollection: string; // empty = "All"
}

export const DEFAULT_SETTINGS: SmartLinkSettings = {
	visibleCollections: [],
	maxResults: 50,
	defaultCollection: "",
};
