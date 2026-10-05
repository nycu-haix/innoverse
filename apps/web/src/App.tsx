import { AuthScreen } from "./components/AuthScreen";
import { Workspace } from "./components/Workspace";
import { useAuth } from "./hooks/useAuth";

export function App() {
	const auth = useAuth();

	if (!auth.status?.authenticated) {
		return <AuthScreen status={auth.status} error={auth.error} busy={auth.busy} onStart={() => void auth.startLogin()} onCancel={() => void auth.cancelLogin()} />;
	}
	return <Workspace account={auth.status.account} onLogout={() => void auth.logout()} />;
}
