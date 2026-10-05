/* global AudioWorkletProcessor, registerProcessor */
/* AudioWorklet: forwards raw mono PCM to the main thread in 2048-sample blocks. */
class PcmCapture extends AudioWorkletProcessor {
	constructor() {
		super();
		this.buffer = new Float32Array(2048);
		this.length = 0;
	}

	process(inputs) {
		const channel = inputs[0] && inputs[0][0];
		if (channel) {
			for (let i = 0; i < channel.length; i++) {
				this.buffer[this.length++] = channel[i];
				if (this.length === this.buffer.length) {
					this.port.postMessage(this.buffer, [this.buffer.buffer]);
					this.buffer = new Float32Array(2048);
					this.length = 0;
				}
			}
		}
		return true;
	}
}

registerProcessor("pcm-capture", PcmCapture);
