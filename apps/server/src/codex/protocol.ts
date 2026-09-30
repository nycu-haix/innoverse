import { z } from "zod";

/**
 * Zod schemas for the subset of the Codex app-server protocol this app consumes.
 * Generated from `codex app-server generate-ts` (codex-cli 0.157) and kept loose
 * (`.loose()`) so newer app-server fields do not break parsing.
 */

export const AccountSchema = z
	.object({
		type: z.string(),
		email: z.string().nullable().optional(),
		planType: z.string().nullable().optional()
	})
	.loose();

export const GetAccountResponseSchema = z
	.object({
		account: AccountSchema.nullable(),
		requiresOpenaiAuth: z.boolean()
	})
	.loose();
export type GetAccountResponse = z.infer<typeof GetAccountResponseSchema>;

export const DeviceCodeLoginResponseSchema = z
	.object({
		type: z.literal("chatgptDeviceCode"),
		loginId: z.string(),
		verificationUrl: z.string(),
		userCode: z.string()
	})
	.loose();

export const LoginCompletedNotificationSchema = z
	.object({
		loginId: z.string().nullable(),
		success: z.boolean(),
		error: z.string().nullable()
	})
	.loose();

export const ReasoningEffortOptionSchema = z.object({ reasoningEffort: z.string() }).loose();

export const CodexModelSchema = z
	.object({
		id: z.string(),
		model: z.string(),
		displayName: z.string(),
		description: z.string().default(""),
		hidden: z.boolean().default(false),
		supportedReasoningEfforts: z.array(ReasoningEffortOptionSchema).default([]),
		defaultReasoningEffort: z.string().nullable().default(null),
		isDefault: z.boolean().default(false)
	})
	.loose();
export type CodexModel = z.infer<typeof CodexModelSchema>;

export const ModelListResponseSchema = z
	.object({
		data: z.array(z.unknown()),
		nextCursor: z.string().nullable().optional()
	})
	.loose();

export const ThreadResponseSchema = z
	.object({
		thread: z.object({ id: z.string() }).loose()
	})
	.loose();

export const TurnErrorSchema = z
	.object({
		message: z.string(),
		codexErrorInfo: z.unknown().nullable().optional()
	})
	.loose();

export const TurnSchema = z
	.object({
		id: z.string(),
		status: z.enum(["completed", "interrupted", "failed", "inProgress"]),
		error: TurnErrorSchema.nullable().optional()
	})
	.loose();

export const TurnStartResponseSchema = z.object({ turn: TurnSchema }).loose();

export const TurnCompletedNotificationSchema = z.object({ threadId: z.string(), turn: TurnSchema }).loose();

export const ItemCompletedNotificationSchema = z
	.object({
		threadId: z.string(),
		turnId: z.string(),
		item: z.object({ type: z.string() }).loose()
	})
	.loose();

export const AgentMessageItemSchema = z
	.object({
		type: z.literal("agentMessage"),
		text: z.string(),
		phase: z.string().nullable().optional()
	})
	.loose();

export const ErrorNotificationSchema = z
	.object({
		threadId: z.string(),
		turnId: z.string(),
		willRetry: z.boolean(),
		error: TurnErrorSchema
	})
	.loose();

export type TurnError = z.infer<typeof TurnErrorSchema>;

/** Extract the error variant name from `codexErrorInfo` (a string or `{ variant: {...} }`). */
export function codexErrorKind(error: TurnError | null | undefined): string | null {
	const info = error?.codexErrorInfo;
	if (typeof info === "string") return info;
	if (info && typeof info === "object") return Object.keys(info)[0] ?? null;
	return null;
}

/** High-volume streaming notifications this app never consumes. */
export const OPT_OUT_NOTIFICATIONS = [
	"item/agentMessage/delta",
	"item/plan/delta",
	"item/reasoning/summaryTextDelta",
	"item/reasoning/summaryPartAdded",
	"item/reasoning/textDelta",
	"item/commandExecution/outputDelta",
	"item/fileChange/outputDelta",
	"command/exec/outputDelta",
	"process/outputDelta",
	"thread/tokenUsage/updated",
	"turn/diff/updated",
	"rawResponseItem/completed",
	"rawResponse/completed"
];
