export interface SmartLinkSettings {
	visibleCollections: string[]; // empty = show all
	maxResults: number;
	defaultCollection: string; // empty = "All"
	showUncreatedLinks: boolean;
	hideImageLinks: boolean;
	triggerPrefix: string; // snippet that opens the inline Smart Link popup
	useVectors: boolean; // blend in semantic ranking from precomputed vectors
	exportDir: string; // vault folder holding the `qmd export` / `qvoid export` output (<dir>/qmd, <dir>/qvoid)
}

export const DEFAULT_SETTINGS: SmartLinkSettings = {
	visibleCollections: [],
	maxResults: 50,
	defaultCollection: "",
	showUncreatedLinks: true,
	hideImageLinks: true,
	triggerPrefix: "s[",
	useVectors: true,
	exportDir: "Scaffolding/Embeddings",
};
