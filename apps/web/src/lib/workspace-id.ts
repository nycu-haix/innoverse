const STORAGE_KEY = "innoverse.workspaceId";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Identifies this browser's workspace (not authentication). Created with
 * crypto.randomUUID() on first visit and kept in localStorage.
 */
export function getWorkspaceId(): string {
	try {
		const existing = localStorage.getItem(STORAGE_KEY);
		if (existing && UUID_PATTERN.test(existing)) return existing;
		const created = crypto.randomUUID();
		localStorage.setItem(STORAGE_KEY, created);
		return created;
	} catch {
		// Storage unavailable (private mode): fall back to a per-session id.
		return crypto.randomUUID();
	}
}
