const TIME_ZONE = "Asia/Taipei";

const clockFormat = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const dateTimeFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

/** 14:02:10 */
export function clock(iso: string): string {
	return clockFormat.format(new Date(iso));
}

/** 2026-10-05 14:02 */
export function dateTime(iso: string): string {
	return dateTimeFormat.format(new Date(iso));
}

/** 00:12:04 */
export function duration(ms: number): string {
	const total = Math.floor(ms / 1000);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}
