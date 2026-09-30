import { z } from "zod";

export const DeviceLoginSchema = z.object({
	loginId: z.string(),
	verificationUrl: z.url(),
	userCode: z.string()
});
export type DeviceLogin = z.infer<typeof DeviceLoginSchema>;

/**
 * Authentication status exposed to the browser. Tokens never leave the server;
 * only display metadata is included.
 */
export const AuthStatusSchema = z.object({
	/** Whether the Codex app-server process is running and initialized. */
	codexAvailable: z.boolean(),
	authenticated: z.boolean(),
	account: z
		.object({
			type: z.string(),
			email: z.string().nullable(),
			planType: z.string().nullable()
		})
		.nullable(),
	pendingLogin: DeviceLoginSchema.nullable(),
	/** User-facing message from the most recent failed login, if any. */
	loginError: z.string().nullable()
});
export type AuthStatus = z.infer<typeof AuthStatusSchema>;

export const DeviceLoginStartResponseSchema = DeviceLoginSchema;
