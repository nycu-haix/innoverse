import type { z } from "zod";
import { AppError } from "../errors";

/** Validate an external input with Zod; any failure becomes a 400 BAD_REQUEST. */
export function parseInput<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
	const parsed = schema.safeParse(value);
	if (!parsed.success) throw new AppError("BAD_REQUEST", { detail: parsed.error.issues.map(issue => issue.path.join(".")).join(",") });
	return parsed.data;
}
