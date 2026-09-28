// Bitcrusher AudioWorklet processor
// Reduces bit depth and sample rate for lo-fi / chiptune effects

class BitcrusherProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'bits', defaultValue: 16, minValue: 1, maxValue: 16 },
            { name: 'rate', defaultValue: 1, minValue: 0.01, maxValue: 1 }
        ];
    }

    constructor() {
        super();
        this._lastSample = 0;
        this._sampleCounter = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];

        if (!input || !input[0]) return true;

        const bits = parameters.bits.length > 1 ? parameters.bits : null;
        const rate = parameters.rate.length > 1 ? parameters.rate : null;
        const bitsVal = bits ? 0 : parameters.bits[0];
        const rateVal = rate ? 0 : parameters.rate[0];

        for (let ch = 0; ch < output.length; ch++) {
            const inp = input[ch] || input[0];
            const out = output[ch];

            for (let i = 0; i < out.length; i++) {
                const b = bits ? bits[i] : bitsVal;
                const r = rate ? rate[i] : rateVal;
                const step = Math.pow(0.5, b);
                const srFactor = Math.max(1, Math.round(1 / Math.max(0.01, r)));

                if (this._sampleCounter % srFactor === 0) {
                    this._lastSample = Math.floor(inp[i] / step) * step;
                }
                out[i] = this._lastSample;
                this._sampleCounter++;
            }
        }

        return true;
    }
}

registerProcessor('bitcrusher-processor', BitcrusherProcessor);
