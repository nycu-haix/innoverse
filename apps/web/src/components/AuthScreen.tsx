import type { AuthStatus } from "@innoverse/shared";
import { Check, Copy, ExternalLink, LoaderCircle } from "lucide-react";
import { useState } from "react";

type Props = {
	status: AuthStatus | null;
	error: string | null;
	busy: boolean;
	onStart: () => void;
	onCancel: () => void;
};

/** Minimal ChatGPT device-code login. The code is entered on the OpenAI page, not here. */
export function AuthScreen({ status, error, busy, onStart, onCancel }: Props) {
	const [copied, setCopied] = useState(false);
	const pending = status?.pendingLogin ?? null;
	const starting = status === null || !status.codexAvailable;

	const copy = async () => {
		if (!pending) return;
		try {
			await navigator.clipboard.writeText(pending.userCode);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 2000);
		} catch {
			setCopied(false);
		}
	};

	return (
		<main className="flex min-h-full items-center justify-center bg-ctp-mantle px-6">
			<div className="w-full max-w-sm space-y-6 text-center">
				<h1 className="text-2xl font-semibold text-ctp-text">登入 ChatGPT</h1>

				{starting && (
					<p className="flex items-center justify-center gap-2 text-sm text-ctp-subtext0">
						<LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
						AI 服務啟動中…
					</p>
				)}

				{!starting && !pending && (
					<button
						type="button"
						onClick={onStart}
						disabled={busy}
						className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-ctp-text px-6 text-sm font-medium text-ctp-base hover:bg-ctp-subtext1 disabled:opacity-50"
					>
						{busy && <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />}
						使用 ChatGPT 帳號登入
					</button>
				)}

				{pending && (
					<div className="space-y-5">
						<p className="text-sm leading-relaxed text-ctp-subtext1">開啟驗證頁面，登入後輸入下方代碼。完成後會自動進入。</p>
						<div className="flex items-center justify-center gap-2">
							<code className="rounded-xl border border-ctp-surface0 bg-ctp-base px-5 py-3 font-mono text-2xl tracking-[0.2em] text-ctp-text" aria-label="驗證代碼">
								{pending.userCode}
							</code>
							<button
								type="button"
								onClick={copy}
								aria-label={copied ? "已複製" : "複製代碼"}
								title="複製代碼"
								className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ctp-subtext1 hover:bg-ctp-base hover:text-ctp-text"
							>
								{copied ? <Check aria-hidden="true" className="h-5 w-5 text-ctp-green" /> : <Copy aria-hidden="true" className="h-5 w-5" />}
							</button>
						</div>
						<a
							href={pending.verificationUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-ctp-text px-6 text-sm font-medium text-ctp-base hover:bg-ctp-subtext1"
						>
							開啟驗證頁面
							<ExternalLink aria-hidden="true" className="h-4 w-4" />
						</a>
						<p className="flex items-center justify-center gap-2 text-xs text-ctp-subtext0">
							<LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
							等待登入完成…
						</p>
						<button type="button" onClick={onCancel} disabled={busy} className="text-sm text-ctp-subtext0 underline-offset-4 hover:text-ctp-text hover:underline">
							取消
						</button>
					</div>
				)}

				{(error ?? status?.loginError) && <p className="text-sm text-ctp-red">{error ?? status?.loginError}</p>}
			</div>
		</main>
	);
}
