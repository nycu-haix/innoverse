import { useMemo } from "react";
import { AuthScreen } from "./components/AuthScreen";
import { Workspace } from "./components/Workspace";
import { useAuth } from "./hooks/useAuth";
import { getWorkspaceId } from "./lib/workspace-id";

export function App() {
	const workspaceId = useMemo(() => getWorkspaceId(), []);
	const auth = useAuth();

	if (!auth.status?.authenticated) {
		return <AuthScreen status={auth.status} error={auth.error} busy={auth.busy} onStart={() => void auth.startLogin()} onCancel={() => void auth.cancelLogin()} />;
	}
	return <Workspace workspaceId={workspaceId} account={auth.status.account} onLogout={() => void auth.logout()} onAuthLost={() => void auth.refresh()} />;
}
