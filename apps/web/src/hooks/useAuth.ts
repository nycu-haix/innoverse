import type { AuthStatus } from "@innoverse/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { userMessage } from "../lib/errors";

/**
 * Codex authentication status. Polls while not authenticated so a completed device
 * login (finished on the OpenAI page) enters the workspace automatically.
 */
export function useAuth() {
	const [status, setStatus] = useState<AuthStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const refresh = useCallback(async () => {
		try {
			setStatus(await api.authStatus());
			setError(null);
		} catch (err) {
			setError(userMessage(err));
		}
	}, []);

	useEffect(() => {
		api.authStatus().then(setStatus, err => setError(userMessage(err)));
	}, []);

	const authenticated = status?.authenticated === true;
	const pending = status?.pendingLogin !== null && status?.pendingLogin !== undefined;

	useEffect(() => {
		if (authenticated) return;
		const timer = window.setInterval(() => void refresh(), pending ? 2_000 : 5_000);
		return () => window.clearInterval(timer);
	}, [authenticated, pending, refresh]);

	const run = useCallback(
		async (action: () => Promise<unknown>) => {
			setBusy(true);
			try {
				await action();
				setError(null);
			} catch (err) {
				setError(userMessage(err));
			} finally {
				setBusy(false);
				await refresh();
			}
		},
		[refresh]
	);

	return {
		status,
		error,
		busy,
		refresh,
		startLogin: () => run(() => api.startDeviceLogin()),
		cancelLogin: () => run(() => api.cancelDeviceLogin()),
		logout: () => run(() => api.logout())
	};
}
