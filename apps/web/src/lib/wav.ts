export const ASR_SAMPLE_RATE = 16_000;

/** Box-filter downsampling; adequate for speech going to an ASR that resamples anyway. */
export function resample(input: Float32Array, fromRate: number, toRate: number = ASR_SAMPLE_RATE): Float32Array {
	if (fromRate === toRate) return input;
	const ratio = fromRate / toRate;
	const length = Math.floor(input.length / ratio);
	const output = new Float32Array(length);
	for (let i = 0; i < length; i++) {
		const start = Math.floor(i * ratio);
		const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
		let sum = 0;
		for (let j = start; j < end; j++) sum += input[j] as number;
		output[i] = sum / (end - start);
	}
	return output;
}

/** 16-bit PCM mono WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number = ASR_SAMPLE_RATE): Blob {
	const buffer = new ArrayBuffer(44 + samples.length * 2);
	const view = new DataView(buffer);
	const ascii = (offset: number, text: string) => {
		for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
	};
	ascii(0, "RIFF");
	view.setUint32(4, 36 + samples.length * 2, true);
	ascii(8, "WAVE");
	ascii(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	ascii(36, "data");
	view.setUint32(40, samples.length * 2, true);
	for (let i = 0; i < samples.length; i++) {
		const clamped = Math.max(-1, Math.min(1, samples[i] as number));
		view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
	}
	return new Blob([buffer], { type: "audio/wav" });
}
