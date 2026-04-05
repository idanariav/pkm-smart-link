export const COLLECTION_MAP: Record<string, string> = {
	"Content/Claims": "claims",
	"Content/Concepts": "concepts",
	"Content/Maps": "maps",
	"Content/Posts": "posts",
	"Content/Insights": "insights",
	"Sources/Books": "books",
	"Sources/Journals": "journals",
	"Sources/Research": "research",
};

/**
 * Detect collection label for a file path using longest-prefix matching.
 */
export function getCollection(filePath: string): string {
	let best = "";
	let bestLen = -1;
	for (const [prefix, label] of Object.entries(COLLECTION_MAP)) {
		if (filePath.startsWith(prefix + "/") && prefix.length > bestLen) {
			best = label;
			bestLen = prefix.length;
		}
	}
	return best || "other";
}

export const ALL_COLLECTIONS = Object.values(COLLECTION_MAP);
