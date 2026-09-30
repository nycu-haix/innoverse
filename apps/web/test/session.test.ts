import { describe, expect, it } from "vitest";
import { initialSession, sessionReducer, type SessionAction, type SessionState } from "../src/state/session";

function run(actions: SessionAction[], state: SessionState = initialSession) {
	return actions.reduce(sessionReducer, state);
}

describe("session state machine", () => {
	it("follows idle → recording → uploading → transcribing → generating → success", () => {
		const states: string[] = [];
		let state = initialSession;
		for (const action of [
			{ type: "record" },
			{ type: "submit" },
			{ type: "stage", stage: "transcribing" },
			{ type: "stage", stage: "generating" },
			{ type: "success", warnings: ["w"] }
		] as SessionAction[]) {
			state = sessionReducer(state, action);
			states.push(state.status);
		}
		expect(states).toEqual(["recording", "uploading", "transcribing", "generating", "success"]);
		expect(state.warnings).toEqual(["w"]);
	});

	it("cancel returns to idle only from recording", () => {
		expect(run([{ type: "record" }, { type: "cancel" }]).status).toBe("idle");
		expect(run([{ type: "record" }, { type: "submit" }, { type: "cancel" }]).status).toBe("uploading");
	});

	it("prevents double submissions and recording while processing", () => {
		const processing = run([{ type: "record" }, { type: "submit" }]);
		expect(sessionReducer(processing, { type: "submit" })).toBe(processing);
		expect(sessionReducer(processing, { type: "record" })).toBe(processing);
		expect(sessionReducer(initialSession, { type: "submit" })).toBe(initialSession);
	});

	it("ignores stages and results that arrive when not processing", () => {
		expect(sessionReducer(initialSession, { type: "stage", stage: "generating" })).toBe(initialSession);
		expect(sessionReducer(initialSession, { type: "success", warnings: [] })).toBe(initialSession);
	});

	it("records errors and allows recording again", () => {
		const failed = run([{ type: "record" }, { type: "submit" }, { type: "fail", error: "產生內容失敗，原本的內容已保留。" }]);
		expect(failed).toEqual({ status: "error", error: "產生內容失敗，原本的內容已保留。", warnings: [] });
		expect(sessionReducer(failed, { type: "record" }).status).toBe("recording");
		expect(sessionReducer(failed, { type: "dismiss" }).status).toBe("idle");
	});
});
