export interface SmartLinkSettings {
	visibleCollections: string[]; // empty = show all
	maxResults: number;
}

export const DEFAULT_SETTINGS: SmartLinkSettings = {
	visibleCollections: [],
	maxResults: 50,
};
