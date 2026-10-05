import { describe, expect, it } from "vitest";
import { SpeechSegmenter } from "../src/lib/segmenter";
import { encodeWav, resample } from "../src/lib/wav";

const RATE = 16_000;

function tone(ms: number, amplitude: number): Float32Array {
	const samples = new Float32Array((RATE * ms) / 1000);
	for (let i = 0; i < samples.length; i++) samples[i] = amplitude * Math.sin((2 * Math.PI * 220 * i) / RATE);
	return samples;
}

function feed(segmenter: SpeechSegmenter, ...parts: Float32Array[]) {
	return parts.flatMap(part => segmenter.push(part));
}

describe("SpeechSegmenter", () => {
	it("cuts utterances at pauses and reports their offsets", () => {
		const segmenter = new SpeechSegmenter({ sampleRate: RATE, maxSegmentMs: 30_000, hangoverMs: 600 });
		const segments = feed(segmenter, tone(1000, 0.0005), tone(1500, 0.3), tone(1000, 0.0005), tone(800, 0.3), tone(1000, 0.0005));
		expect(segments).toHaveLength(2);
		const [first, second] = segments;
		// Includes ~300 ms pre-roll before the onset and a short tail after.
		expect(first!.startOffsetMs).toBeGreaterThanOrEqual(600);
		expect(first!.startOffsetMs).toBeLessThanOrEqual(1000);
		expect(first!.durationMs).toBeGreaterThan(1500);
		expect(first!.durationMs).toBeLessThan(2200);
		expect(second!.startOffsetMs).toBeGreaterThan(3000);
		expect(first!.samples.length).toBe((first!.durationMs * RATE) / 1000);
	});

	it("ignores short noise and stays silent on a quiet stream", () => {
		const segmenter = new SpeechSegmenter({ sampleRate: RATE, maxSegmentMs: 30_000 });
		expect(feed(segmenter, tone(1000, 0.0005), tone(100, 0.3), tone(1500, 0.0005))).toEqual([]);
		expect(segmenter.flush()).toBeNull();
	});

	it("splits continuous speech at the maximum length", () => {
		const segmenter = new SpeechSegmenter({ sampleRate: RATE, maxSegmentMs: 2_000 });
		const segments = feed(segmenter, tone(500, 0.0005), tone(5000, 0.3));
		expect(segments.length).toBeGreaterThanOrEqual(2);
		expect(segments[0]!.durationMs).toBe(2000);
		const tail = segmenter.flush();
		expect(tail).not.toBeNull();
		expect(segmenter.speaking).toBe(false);
	});
});

describe("wav", () => {
	it("downsamples and encodes 16-bit mono PCM", async () => {
		const input = new Float32Array(48_000).fill(0.5);
		const output = resample(input, 48_000);
		expect(output.length).toBe(16_000);
		expect(output[100]).toBeCloseTo(0.5);

		const blob = encodeWav(new Float32Array([0, 1, -1]));
		expect(blob.type).toBe("audio/wav");
		const view = new DataView(await blob.arrayBuffer());
		expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe("RIFF");
		expect(view.getUint32(24, true)).toBe(16_000);
		expect(view.getInt16(46, true)).toBe(32767);
		expect(view.getInt16(48, true)).toBe(-32768);
	});
});
