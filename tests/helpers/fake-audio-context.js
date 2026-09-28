/**
 * Minimal Web Audio double for Node.
 *
 * Enough of the API for the engine to build its graph and schedule notes, and
 * it records what happened: every node created, every connection, every
 * parameter automation. Tests assert on the graph, not on sound.
 */

class FakeAudioParam {
    constructor(value = 0) {
        this.value = value;
        /** @type {Array<{method: string, args: number[]}>} */
        this.automation = [];
    }

    setValueAtTime(value, time) {
        this.value = value;
        this.automation.push({ method: 'setValueAtTime', args: [value, time] });
        return this;
    }

    linearRampToValueAtTime(value, time) {
        this.value = value;
        this.automation.push({ method: 'linearRampToValueAtTime', args: [value, time] });
        return this;
    }

    exponentialRampToValueAtTime(value, time) {
        this.value = value;
        this.automation.push({ method: 'exponentialRampToValueAtTime', args: [value, time] });
        return this;
    }

    setTargetAtTime(value, time, constant) {
        this.value = value;
        this.automation.push({ method: 'setTargetAtTime', args: [value, time, constant] });
        return this;
    }

    cancelScheduledValues(time) {
        this.automation.push({ method: 'cancelScheduledValues', args: [time] });
        return this;
    }

    cancelAndHoldAtTime(time) {
        this.automation.push({ method: 'cancelAndHoldAtTime', args: [time] });
        return this;
    }
}

class FakeAudioNode {
    constructor(context, kind) {
        this.context = context;
        this.kind = kind;
        /** @type {FakeAudioNode[]} */
        this.outputs = [];
        this.disconnected = false;
        this.started = null;
        this.stopped = null;
        this.channelCount = 2;
    }

    connect(target) {
        this.outputs.push(target);
        this.context.connections.push({ from: this, to: target });
        return target;
    }

    disconnect(target) {
        if (target) {
            if (!this.outputs.includes(target)) {
                // Matches the real API, which throws on an unknown target.
                throw new Error('node is not connected to the given destination');
            }
            this.outputs = this.outputs.filter((node) => node !== target);
        } else {
            this.outputs = [];
        }
        this.context.connections = this.context.connections.filter(
            (edge) => edge.from !== this || (target ? edge.to !== target : false)
        );
        this.disconnected = true;
    }

    start(when = 0) {
        this.started = when;
    }

    stop(when = 0) {
        this.stopped = when;
    }

    setPeriodicWave(wave) {
        this.periodicWave = wave;
    }

    /**
     * True when this node reaches `target` by following connections.
     * A connection can end on an AudioParam, which has no outputs of its own.
     */
    reaches(target) {
        const seen = new Set();
        const walk = (node) => {
            if (node === target) return true;
            if (seen.has(node) || !node?.outputs) return false;
            seen.add(node);
            return node.outputs.some(walk);
        };
        return walk(this);
    }
}

export class FakeAudioContext {
    /**
     * @param {object} [options]
     * @param {number} [options.sampleRate]
     * @param {number} [options.length] frames, for an offline render
     */
    constructor({ sampleRate = 48000, length = 0 } = {}) {
        this.sampleRate = sampleRate;
        this.length = length;
        this.currentTime = 0;
        this.state = 'running';
        /** @type {FakeAudioNode[]} */
        this.nodes = [];
        /** @type {Array<{from: FakeAudioNode, to: FakeAudioNode}>} */
        this.connections = [];
        this.destination = this._node('destination');
    }

    _node(kind, props = {}) {
        const node = new FakeAudioNode(this, kind);
        Object.assign(node, props);
        this.nodes.push(node);
        return node;
    }

    /** Every node of a kind, in creation order. */
    nodesOfKind(kind) {
        return this.nodes.filter((node) => node.kind === kind);
    }

    createGain() {
        return this._node('gain', { gain: new FakeAudioParam(1) });
    }

    createAnalyser() {
        const node = this._node('analyser', {
            fftSize: 2048,
            smoothingTimeConstant: 0.8,
            getByteTimeDomainData: (array) => array.fill(128),
            getByteFrequencyData: (array) => array.fill(0)
        });
        Object.defineProperty(node, 'frequencyBinCount', {
            get() {
                return this.fftSize / 2;
            }
        });
        return node;
    }

    createBiquadFilter() {
        return this._node('biquad', {
            type: 'lowpass',
            frequency: new FakeAudioParam(350),
            Q: new FakeAudioParam(1),
            gain: new FakeAudioParam(0),
            detune: new FakeAudioParam(0)
        });
    }

    createStereoPanner() {
        return this._node('panner', { pan: new FakeAudioParam(0) });
    }

    createDynamicsCompressor() {
        return this._node('compressor', {
            threshold: new FakeAudioParam(-24),
            knee: new FakeAudioParam(30),
            ratio: new FakeAudioParam(12),
            attack: new FakeAudioParam(0.003),
            release: new FakeAudioParam(0.25),
            reduction: 0
        });
    }

    createDelay(maxDelay = 1) {
        return this._node('delay', { maxDelay, delayTime: new FakeAudioParam(0) });
    }

    createOscillator() {
        return this._node('oscillator', {
            type: 'sine',
            frequency: new FakeAudioParam(440),
            detune: new FakeAudioParam(0)
        });
    }

    createBufferSource() {
        return this._node('bufferSource', {
            buffer: null,
            loop: false,
            playbackRate: new FakeAudioParam(1),
            detune: new FakeAudioParam(0)
        });
    }

    createBuffer(channels, length, sampleRate) {
        const data = Array.from({ length: channels }, () => new Float32Array(length));
        return {
            numberOfChannels: channels,
            length,
            sampleRate,
            duration: length / sampleRate,
            getChannelData: (channel) => data[channel]
        };
    }

    createPeriodicWave(real, imag, options) {
        return { kind: 'periodicWave', real, imag, options };
    }

    createWaveShaper() {
        return this._node('waveShaper', { curve: null, oversample: 'none' });
    }

    createConvolver() {
        return this._node('convolver', { buffer: null, normalize: true });
    }

    createConstantSource() {
        return this._node('constantSource', { offset: new FakeAudioParam(1) });
    }

    /** Deprecated in the spec, still the fallback when no AudioWorklet exists. */
    createScriptProcessor(bufferSize = 4096, inputs = 1, outputs = 1) {
        return this._node('scriptProcessor', {
            bufferSize,
            numberOfInputs: inputs,
            numberOfOutputs: outputs,
            onaudioprocess: null
        });
    }

    async resume() {
        this.state = 'running';
    }

    async suspend() {
        this.state = 'suspended';
    }

    async close() {
        this.state = 'closed';
    }

    /** Move the clock forward, the way scheduled playback would. */
    advance(seconds) {
        this.currentTime += seconds;
    }

    /**
     * Stand in for an OfflineAudioContext render. No audio is computed: the
     * point of these tests is the graph that was built, not its sound.
     */
    async startRendering() {
        this.rendered = true;
        return this.createBuffer(2, this.length || 1, this.sampleRate);
    }
}

/** An offline context double, shaped like the render code expects. */
export function fakeOfflineContextFactory(record = {}) {
    return (channels, length, sampleRate) => {
        const context = new FakeAudioContext({ sampleRate, length });
        context.numberOfChannels = channels;
        record.context = context;
        return context;
    };
}

/** Factory shaped like the engine's `createContext` option. */
export function fakeContextFactory(options) {
    return () => new FakeAudioContext(options);
}
