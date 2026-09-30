/** localStorage helpers for small per-browser preferences. Never used for credentials. */
export function readPreference(key: string): string | null {
	try {
		return localStorage.getItem(`innoverse.${key}`);
	} catch {
		return null;
	}
}

export function writePreference(key: string, value: string | null): void {
	try {
		if (value === null) localStorage.removeItem(`innoverse.${key}`);
		else localStorage.setItem(`innoverse.${key}`, value);
	} catch {
		// ignore
	}
}
