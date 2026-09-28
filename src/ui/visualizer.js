/**
 * The analyser.
 *
 * Seven ways of looking at the master bus, drawn on one canvas: a spectrum
 * with peak hold, an oscilloscope, a VU pair, a rolling spectrogram, a
 * wireframe of the spectrum's recent history, a level graph, and a mid/side
 * comparison. They share the engine's analyser node and a frame loop; each
 * mode is a grid and a draw.
 *
 * The canvas is sized in device pixels and scaled back down, so the lines are
 * one pixel wide on a high-density screen rather than two blurred ones.
 *
 * It draws only while something is playing. An analyser reading silence is a
 * flat line at sixty frames a second, which costs the same as a real one.
 */

export const VISUALIZER_MODES = Object.freeze([
    'spectrum',
    'oscilloscope',
    'vu',
    'spectrogram',
    'wireframe',
    'levelhistory',
    'msscope'
]);

export class Visualizer {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     */
    constructor({ root, studio }) {
        this.root = root;
        this.studio = studio;
        this.audioEngine = studio.audioEngine;
        this.canvas = null;
        this.ctx = null;
        this.analyser = null;
        this.spectrumData = null;
        this.timeData = null;
        this.bufferLength = 0;
        this.animationId = null;
        this.isActive = false;

        this.modes = [...VISUALIZER_MODES];
        this.mode = 'spectrum';

        // ── Spectrum peak hold ──────────────────────────────────────────────
        this.peakData = null;
        this.peakHoldTimer = null;
        this.PEAK_HOLD_FRAMES = 90;
        this.PEAK_DECAY = 0.003;

        // ── VU Meter ────────────────────────────────────────────────────────
        this._vuPeakL = 0;
        this._vuPeakR = 0;
        this._vuHoldL = 0;
        this._vuHoldR = 0;
        this._vuRmsL = 0;
        this._vuRmsR = 0;
        this.VU_PEAK_HOLD = 90;
        this.VU_PEAK_DECAY = 0.008;

        // ── Spectrogram ─────────────────────────────────────────────────────
        this._sgRows = 140;
        this._sgNumBars = 200;
        this._sgBuf = null;
        this._sgHead = 0;

        // ── Wireframe ───────────────────────────────────────────────────────
        this._wfSmooth = null; // Float32Array: per-frame smoothed freq data
        this._wfCols = 64; // number of frequency columns
        this._wfRows = 8; // number of depth rows

        // ── Level History ───────────────────────────────────────────────────
        this._lhLen = 500; // number of time points stored
        this._lhBuf = null; // Array<{peak, rms}>
        this._lhHead = 0;

        // ── M/S Scope ───────────────────────────────────────────────────────
        this._msAvg = null; // slow-smoothed average (Mid proxy)

        // ── CSS dimensions ───────────────────────────────────────────────────
        this._cssW = 0;
        this._cssH = 0;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Find the canvas and start watching its size. The analyser itself only
     * exists once the audio has been started, so `attach` comes later.
     */
    init() {
        this.canvas = this.root.querySelector('#audioVisualizer');
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');

        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObs = new ResizeObserver(() => {
                this._resizeCanvas();
                if (!this.isActive) this._drawIdle();
            });
            this._resizeObs.observe(this.canvas.parentElement || this.canvas);
        }
        this._resizeCanvas();

        this._drawIdle();
    }

    /** Take the engine's analyser and size every buffer to it. */
    attach() {
        if (this.analyser || !this.audioEngine?.analyser) return;

        this.analyser = this.audioEngine.analyser;
        this.analyser.fftSize = 4096;
        this.analyser.smoothingTimeConstant = 0.8;
        this.analyser.minDecibels = -90;
        this.analyser.maxDecibels = 0;
        this.bufferLength = this.analyser.frequencyBinCount; // 2048
        this.spectrumData = new Uint8Array(this.bufferLength);
        this.timeData = new Uint8Array(this.bufferLength);
        this.peakData = new Float32Array(this.bufferLength).fill(0);
        this.peakHoldTimer = new Int32Array(this.bufferLength).fill(0);
        // Spectrogram
        this._sgBuf = Array.from({ length: this._sgRows }, () => new Uint8Array(this._sgNumBars));
        // Wireframe: smooth buffer (same size as freq cols used)
        this._wfSmooth = new Float32Array(this._wfCols + this._wfRows * 6).fill(0);
        // Level history
        this._lhBuf = Array.from({ length: this._lhLen }, () => ({ peak: 0, rms: 0 }));
        // M/S
        this._msAvg = new Float32Array(this.bufferLength).fill(0);

        this._resizeCanvas();
        this._drawIdle();
    }

    start() {
        if (!this.analyser || this.isActive) return;
        this.isActive = true;
        this._resizeCanvas();
        this._draw();
    }

    stop() {
        this.isActive = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this._drawIdle();
    }

    toggle() {
        if (this.isActive) this.stop();
        else this.start();
    }

    setMode(mode) {
        if (!this.modes.includes(mode)) return;
        this.mode = mode;
        if (this.peakData) this.peakData.fill(0);
        if (this.peakHoldTimer) this.peakHoldTimer.fill(0);
        this._vuPeakL = this._vuPeakR = 0;
        this._vuHoldL = this._vuHoldR = 0;
        this._vuRmsL = this._vuRmsR = 0;
        if (this._sgBuf) {
            this._sgBuf.forEach((r) => r.fill(0));
            this._sgHead = 0;
        }
        if (this._wfSmooth) this._wfSmooth.fill(0);
        if (this._lhBuf) {
            this._lhBuf.forEach((r) => {
                r.peak = 0;
                r.rms = 0;
            });
            this._lhHead = 0;
        }
        if (this._msAvg) this._msAvg.fill(0);
        if (this.ctx && this._cssW) {
            this.ctx.fillStyle = '#0a0a18';
            this.ctx.fillRect(0, 0, this._cssW, this._cssH);
        }
    }

    getMode() {
        return this.mode;
    }
    getModes() {
        return [...this.modes];
    }

    // ── Idle frame ────────────────────────────────────────────────────────────

    _drawIdle() {
        if (!this.ctx || !this._cssW) return;
        const ctx = this.ctx,
            w = this._cssW,
            h = this._cssH;
        ctx.fillStyle = '#0a0a18';
        ctx.fillRect(0, 0, w, h);
        switch (this.mode) {
            case 'spectrum':
                this._drawSpecGrid(ctx, w, h);
                break;
            case 'oscilloscope':
                this._drawOscGrid(ctx, w, h);
                break;
            case 'vu':
                this._drawVUGrid(ctx, w, h);
                break;
            case 'spectrogram':
                this._drawSGGrid(ctx, w, h);
                break;
            case 'wireframe':
                this._drawWFGrid(ctx, w, h);
                break;
            case 'levelhistory':
                this._drawLHGrid(ctx, w, h);
                break;
            case 'msscope':
                this._drawSpecGrid(ctx, w, h);
                break;
        }
    }

    // ── Resize (DPR-aware) ────────────────────────────────────────────────────

    _resizeCanvas() {
        if (!this.canvas || !this.ctx) return;
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return;
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this._cssW = rect.width;
        this._cssH = rect.height;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _freqToX(freq, w) {
        const _w = w ?? this._cssW;
        return (Math.log10(freq / 20) / Math.log10(20000 / 20)) * _w;
    }

    _linToDb(lin) {
        return lin > 0 ? 20 * Math.log10(lin) : -Infinity;
    }

    _metric(ctx, text, x, y, align = 'left', color = 'rgba(255,255,255,0.80)') {
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = align;
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = 'rgba(0,0,0,0.60)';
        ctx.fillText(text, x + 0.5, y + 0.5);
        ctx.fillStyle = color;
        ctx.fillText(text, x, y);
    }

    // ── Main loop ─────────────────────────────────────────────────────────────

    _draw() {
        if (!this.isActive) return;
        this.animationId = requestAnimationFrame(() => this._draw());
        if (!this._cssW || !this.analyser) return;

        const ctx = this.ctx,
            w = this._cssW,
            h = this._cssH;

        ctx.fillStyle = '#0a0a18';
        ctx.fillRect(0, 0, w, h);

        switch (this.mode) {
            case 'spectrum':
                this._drawSpecGrid(ctx, w, h);
                this._drawSpectrum(ctx, w, h);
                this._drawSpecMetrics(ctx, w, h);
                break;
            case 'oscilloscope':
                this._drawOscGrid(ctx, w, h);
                this._drawOscilloscope(ctx, w, h);
                this._drawOscMetrics(ctx, w, h);
                break;
            case 'vu':
                this._drawVU(ctx, w, h);
                break;
            case 'spectrogram':
                this._drawSpectrogram(ctx, w, h);
                this._drawSGGrid(ctx, w, h);
                this._drawSGMetrics(ctx, w, h);
                break;
            case 'wireframe':
                this._drawWireframe(ctx, w, h);
                this._drawWFGrid(ctx, w, h);
                this._drawWFMetrics(ctx, w, h);
                break;
            case 'levelhistory':
                this._drawLHGrid(ctx, w, h);
                this._drawLevelHistory(ctx, w, h);
                this._drawLHMetrics(ctx, w, h);
                break;
            case 'msscope':
                this._drawSpecGrid(ctx, w, h);
                this._drawMSScope(ctx, w, h);
                this._drawMSMetrics(ctx, w, h);
                break;
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  SPECTRUM ANALYZER
    // ══════════════════════════════════════════════════════════════════════════

    _drawSpecGrid(ctx, w, h) {
        ctx.font = '8px sans-serif';
        ctx.lineWidth = 0.5;
        const freqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
        const decades = new Set([20, 100, 1000, 10000, 20000]);
        for (const f of freqs) {
            const x = this._freqToX(f, w);
            ctx.strokeStyle = decades.has(f) ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.05)';
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
            const label = f >= 1000 ? f / 1000 + 'k' : String(f);
            ctx.fillStyle = decades.has(f) ? 'rgba(255,255,255,0.38)' : 'rgba(255,255,255,0.18)';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(label, x + 2, h - 3);
        }
        const dbLines = [0, -12, -24, -36, -48, -60, -72];
        for (const db of dbLines) {
            const y = h - ((db + 90) / 90) * h;
            ctx.strokeStyle = db === 0 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)';
            ctx.lineWidth = db === 0 ? 1 : 0.5;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
            ctx.fillStyle = db === 0 ? 'rgba(255,255,255,0.40)' : 'rgba(255,255,255,0.22)';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(db === 0 ? '0 dB' : db + ' dB', 2, y - 2);
        }
    }

    _drawSpectrum(ctx, w, h) {
        this.analyser.getByteFrequencyData(this.spectrumData);
        const binCount = this.spectrumData.length,
            sampleRate = this.analyser.context.sampleRate,
            numBars = 200;
        const barColor = (freq, alpha) => {
            if (freq < 60) return `rgba(210, 50, 50,${alpha})`;
            if (freq < 250) return `rgba(215,115, 35,${alpha})`;
            if (freq < 800) return `rgba( 89,162,140,${alpha})`;
            if (freq < 2500) return `rgba( 55,130,210,${alpha})`;
            if (freq < 8000) return `rgba(115, 75,215,${alpha})`;
            return `rgba(185, 95,240,${alpha})`;
        };
        for (let i = 0; i < numBars; i++) {
            const f0 = 20 * Math.pow(20000 / 20, i / numBars),
                f1 = 20 * Math.pow(20000 / 20, (i + 1) / numBars),
                fMid = (f0 + f1) / 2;
            const bin0 = Math.max(0, Math.floor((f0 * binCount * 2) / sampleRate));
            const bin1 = Math.min(binCount - 1, Math.ceil((f1 * binCount * 2) / sampleRate));
            let maxVal = 0;
            for (let b = bin0; b <= bin1; b++)
                if (this.spectrumData[b] > maxVal) maxVal = this.spectrumData[b];
            const val = maxVal / 255;
            const binRef = Math.min(binCount - 1, Math.round((bin0 + bin1) / 2));
            if (val > this.peakData[binRef]) {
                this.peakData[binRef] = val;
                this.peakHoldTimer[binRef] = this.PEAK_HOLD_FRAMES;
            } else if (this.peakHoldTimer[binRef] > 0) {
                this.peakHoldTimer[binRef]--;
            } else {
                this.peakData[binRef] = Math.max(0, this.peakData[binRef] - this.PEAK_DECAY);
            }
            const x = this._freqToX(f0, w),
                barW = Math.max(1, this._freqToX(f1, w) - x - 0.5);
            ctx.fillStyle = barColor(fMid, 0.78);
            ctx.fillRect(x, h - val * h * 0.92, barW, val * h * 0.92);
            const peakH = this.peakData[binRef] * h * 0.92;
            if (peakH > 2) {
                ctx.fillStyle = barColor(fMid, 1.0);
                ctx.fillRect(x, h - peakH - 1, barW, 1);
            }
        }
    }

    _drawSpecMetrics(ctx, w, _h) {
        if (!this.spectrumData || !this.timeData) return;
        const sampleRate = this.analyser.context.sampleRate,
            binCount = this.spectrumData.length;
        let maxBin = 1,
            maxVal = 0;
        for (let i = 1; i < binCount; i++)
            if (this.spectrumData[i] > maxVal) {
                maxVal = this.spectrumData[i];
                maxBin = i;
            }
        const peakFreq = (maxBin * sampleRate) / (binCount * 2);
        const peakDb = (maxVal / 255) * 90 - 90;
        const freqLbl =
            peakFreq >= 1000 ? (peakFreq / 1000).toFixed(1) + ' kHz' : Math.round(peakFreq) + ' Hz';
        this.analyser.getByteTimeDomainData(this.timeData);
        let rmsSum = 0;
        for (let i = 0; i < this.timeData.length; i++) {
            const v = this.timeData[i] / 128 - 1;
            rmsSum += v * v;
        }
        const rmsDb = this._linToDb(Math.sqrt(rmsSum / this.timeData.length));
        const pad = 4;
        this._metric(
            ctx,
            `Peak: ${isFinite(peakDb) ? peakDb.toFixed(1) + ' dBFS' : '-∞'}`,
            w - pad,
            10,
            'right'
        );
        this._metric(
            ctx,
            `RMS:  ${isFinite(rmsDb) ? rmsDb.toFixed(1) + ' dBFS' : '-∞'}`,
            w - pad,
            21,
            'right'
        );
        this._metric(ctx, `@ ${freqLbl}`, w - pad, 32, 'right');
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  OSCILLOSCOPE
    // ══════════════════════════════════════════════════════════════════════════

    _drawOscGrid(ctx, w, h) {
        ctx.font = '8px sans-serif';
        ctx.lineWidth = 0.5;
        for (const { v, label } of [
            { v: 1, label: '+1' },
            { v: 0.5, label: '+.5' },
            { v: 0, label: '0' },
            { v: -0.5, label: '-.5' },
            { v: -1, label: '-1' }
        ]) {
            const y = h / 2 - v * ((h / 2) * 0.92);
            ctx.strokeStyle = v === 0 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)';
            ctx.lineWidth = v === 0 ? 1 : 0.5;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
            ctx.fillStyle = v === 0 ? 'rgba(255,255,255,0.38)' : 'rgba(255,255,255,0.20)';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(label, 2, y - 2);
        }
    }

    _drawOscilloscope(ctx, w, h) {
        this.analyser.getByteTimeDomainData(this.timeData);
        const sliceW = w / this.timeData.length;
        ctx.beginPath();
        for (let i = 0; i < this.timeData.length; i++) {
            const v = this.timeData[i] / 128 - 1,
                y = h / 2 - v * ((h / 2) * 0.92);
            i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * sliceW, y);
        }
        ctx.strokeStyle = '#59a28c';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    _drawOscMetrics(ctx, w, _h) {
        if (!this.timeData) return;
        let rmsSum = 0,
            maxAbs = 0;
        for (let i = 0; i < this.timeData.length; i++) {
            const v = this.timeData[i] / 128 - 1;
            rmsSum += v * v;
            if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
        }
        const peakDb = this._linToDb(maxAbs),
            rmsDb = this._linToDb(Math.sqrt(rmsSum / this.timeData.length));
        const crest =
            isFinite(peakDb) && isFinite(rmsDb) ? (peakDb - rmsDb).toFixed(1) + ' dB' : '-';
        const pad = 4;
        this._metric(
            ctx,
            `Peak:  ${isFinite(peakDb) ? peakDb.toFixed(1) + ' dBFS' : '-∞'}`,
            w - pad,
            10,
            'right'
        );
        this._metric(
            ctx,
            `RMS:   ${isFinite(rmsDb) ? rmsDb.toFixed(1) + ' dBFS' : '-∞'}`,
            w - pad,
            21,
            'right'
        );
        this._metric(ctx, `Crest: ${crest}`, w - pad, 32, 'right');
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  VU METER
    // ══════════════════════════════════════════════════════════════════════════

    _drawVUGrid(ctx, w, h) {
        this._drawVUScale(ctx, w, h);
    }

    _drawVU(ctx, w, h) {
        this.analyser.getByteTimeDomainData(this.timeData);
        const half = Math.floor(this.timeData.length / 2);
        let sumL = 0,
            sumR = 0,
            pkL = 0,
            pkR = 0;
        for (let i = 0; i < half; i++) {
            const vL = Math.abs(this.timeData[i] / 128 - 1),
                vR = Math.abs(this.timeData[i + half] / 128 - 1);
            sumL += vL * vL;
            sumR += vR * vR;
            if (vL > pkL) pkL = vL;
            if (vR > pkR) pkR = vR;
        }
        const rmsL = Math.sqrt(sumL / half),
            rmsR = Math.sqrt(sumR / half);
        this._vuRmsL =
            rmsL > this._vuRmsL
                ? this._vuRmsL * 0.4 + rmsL * 0.6
                : this._vuRmsL * 0.93 + rmsL * 0.07;
        this._vuRmsR =
            rmsR > this._vuRmsR
                ? this._vuRmsR * 0.4 + rmsR * 0.6
                : this._vuRmsR * 0.93 + rmsR * 0.07;
        if (pkL >= this._vuPeakL) {
            this._vuPeakL = pkL;
            this._vuHoldL = this.VU_PEAK_HOLD;
        } else if (this._vuHoldL > 0) {
            this._vuHoldL--;
        } else {
            this._vuPeakL = Math.max(0, this._vuPeakL - this.VU_PEAK_DECAY);
        }
        if (pkR >= this._vuPeakR) {
            this._vuPeakR = pkR;
            this._vuHoldR = this.VU_PEAK_HOLD;
        } else if (this._vuHoldR > 0) {
            this._vuHoldR--;
        } else {
            this._vuPeakR = Math.max(0, this._vuPeakR - this.VU_PEAK_DECAY);
        }
        const rmsDbL = this._linToDb(this._vuRmsL),
            rmsDbR = this._linToDb(this._vuRmsR);
        const pkDbL = this._linToDb(this._vuPeakL),
            pkDbR = this._linToDb(this._vuPeakR);
        const vuMap = (db) => Math.max(0, Math.min(1, (db + 20) / 23));
        const padX = 36,
            gap = 10,
            barH = Math.max(18, Math.floor((h - padX - gap - 28) / 2)),
            barW = w - padX * 2,
            yL = 16,
            yR = 16 + barH + gap;
        ctx.font = '9px monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText('L', padX - 6, yL + barH / 2);
        ctx.fillText('R', padX - 6, yR + barH / 2);
        this._drawVUBar(
            ctx,
            padX,
            yL,
            barW,
            barH,
            vuMap(isFinite(rmsDbL) ? rmsDbL + 18 : -20),
            vuMap(isFinite(pkDbL) ? pkDbL + 18 : -20),
            isFinite(pkDbL) ? pkDbL + 18 : -20
        );
        this._drawVUBar(
            ctx,
            padX,
            yR,
            barW,
            barH,
            vuMap(isFinite(rmsDbR) ? rmsDbR + 18 : -20),
            vuMap(isFinite(pkDbR) ? pkDbR + 18 : -20),
            isFinite(pkDbR) ? pkDbR + 18 : -20
        );
        this._drawVUScale(ctx, w, h);
        const f = (db) => (isFinite(db) ? db.toFixed(1) : '-∞');
        this._metric(
            ctx,
            `L  RMS: ${f(rmsDbL)} dBFS   Peak: ${f(pkDbL)} dBFS`,
            w / 2,
            h - 14,
            'center'
        );
        this._metric(
            ctx,
            `R  RMS: ${f(rmsDbR)} dBFS   Peak: ${f(pkDbR)} dBFS`,
            w / 2,
            h - 3,
            'center'
        );
    }

    _drawVUBar(ctx, x, y, w, h, rmsT, peakT, peakDbVU) {
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fillRect(x, y, w, h);
        if (rmsT > 0) {
            const fillW = w * rmsT,
                gEnd = w * (17 / 23),
                yEnd = w * (20 / 23);
            if (fillW > 0) {
                const g = ctx.createLinearGradient(x, 0, x + gEnd, 0);
                g.addColorStop(0, 'rgba(30,160,80,.9)');
                g.addColorStop(0.6, 'rgba(60,200,80,.9)');
                g.addColorStop(1, 'rgba(100,220,60,.9)');
                ctx.fillStyle = g;
                ctx.fillRect(x, y, Math.min(fillW, gEnd), h);
            }
            if (fillW > gEnd) {
                const g = ctx.createLinearGradient(x + gEnd, 0, x + yEnd, 0);
                g.addColorStop(0, 'rgba(230,210,40,.92)');
                g.addColorStop(1, 'rgba(255,140,0,.92)');
                ctx.fillStyle = g;
                ctx.fillRect(x + gEnd, y, Math.min(fillW, yEnd) - gEnd, h);
            }
            if (fillW > yEnd) {
                ctx.fillStyle = 'rgba(220,50,50,.95)';
                ctx.fillRect(x + yEnd, y, fillW - yEnd, h);
            }
        }
        const segW = w / 40;
        ctx.fillStyle = 'rgba(10,10,24,.40)';
        for (let s = 1; s < 40; s++) ctx.fillRect(x + s * segW - 0.5, y, 1, h);
        if (peakT > 0.005) {
            ctx.fillStyle = peakDbVU > 0 ? 'rgba(255,80,80,1)' : 'rgba(255,255,200,.95)';
            ctx.fillRect(x + w * peakT - 2, y - 1, 2, h + 2);
        }
    }

    _drawVUScale(ctx, w, h) {
        const padX = 36,
            barW = w - padX * 2,
            gap = 10,
            barH = Math.max(18, Math.floor((h - padX - gap - 28) / 2));
        const yR = 16 + barH + gap,
            scaleY = yR + barH + 4;
        ctx.font = '7px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (const db of [-20, -18, -12, -9, -6, -3, 0, 3]) {
            const x = padX + ((db + 20) / 23) * barW;
            ctx.strokeStyle = db >= 0 ? 'rgba(255,80,80,.5)' : 'rgba(255,255,255,.20)';
            ctx.lineWidth = db === 0 ? 1 : 0.5;
            ctx.beginPath();
            ctx.moveTo(x, scaleY);
            ctx.lineTo(x, scaleY + 4);
            ctx.stroke();
            ctx.fillStyle = db >= 0 ? 'rgba(255,100,100,.70)' : 'rgba(255,255,255,.35)';
            ctx.fillText(db > 0 ? '+' + db : String(db), x, scaleY + 5);
        }
        ctx.fillStyle = 'rgba(255,255,255,.18)';
        ctx.textAlign = 'right';
        ctx.fillText('dBVU', w - 2, scaleY + 5);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  SPECTROGRAM (WATERFALL)
    // ══════════════════════════════════════════════════════════════════════════

    _drawSGGrid(ctx, w, h) {
        ctx.font = '7px monospace';
        ctx.lineWidth = 0.5;
        for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
            const x = this._freqToX(f, w);
            ctx.strokeStyle = 'rgba(255,255,255,0.10)';
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
            const label = f >= 1000 ? f / 1000 + 'k' : String(f);
            ctx.fillStyle = 'rgba(255,255,255,0.30)';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(label, x + 2, 2);
        }
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('▲ now', 2, 2);
    }

    _drawSpectrogram(ctx, w, h) {
        this.analyser.getByteFrequencyData(this.spectrumData);
        const binCount = this.spectrumData.length,
            sampleRate = this.analyser.context.sampleRate,
            numBars = this._sgNumBars;
        const row = this._sgBuf[this._sgHead];
        for (let i = 0; i < numBars; i++) {
            const f0 = 20 * Math.pow(20000 / 20, i / numBars),
                f1 = 20 * Math.pow(20000 / 20, (i + 1) / numBars);
            const b0 = Math.max(0, Math.floor((f0 * binCount * 2) / sampleRate)),
                b1 = Math.min(binCount - 1, Math.ceil((f1 * binCount * 2) / sampleRate));
            let mx = 0;
            for (let b = b0; b <= b1; b++) if (this.spectrumData[b] > mx) mx = this.spectrumData[b];
            row[i] = mx;
        }
        this._sgHead = (this._sgHead + 1) % this._sgRows;
        const rowH = h / this._sgRows,
            barW = w / numBars;
        for (let r = 0; r < this._sgRows; r++) {
            const rowData = this._sgBuf[(this._sgHead + r) % this._sgRows];
            const yTop = r * rowH;
            for (let i = 0; i < numBars; i++) {
                const val = rowData[i] / 255;
                if (val < 0.01) continue;
                ctx.fillStyle = this._sgColor(val);
                ctx.fillRect(i * barW, yTop, barW + 0.5, rowH + 0.5);
            }
        }
    }

    _sgColor(t) {
        if (t < 0.2) {
            const s = t / 0.2;
            return `rgb(${Math.round(s * 20)},${Math.round(s * 40)},${Math.round(s * 190)})`;
        }
        if (t < 0.45) {
            const s = (t - 0.2) / 0.25;
            return `rgb(${Math.round(s * 20)},${Math.round(40 + s * 170)},${Math.round(190 - s * 150)})`;
        }
        if (t < 0.65) {
            const s = (t - 0.45) / 0.2;
            return `rgb(${Math.round(s * 220)},${Math.round(210 - s * 60)},${Math.round(40 - s * 40)})`;
        }
        if (t < 0.85) {
            const s = (t - 0.65) / 0.2;
            return `rgb(${Math.round(220 + s * 35)},${Math.round(150 - s * 110)},0)`;
        }
        {
            const s = (t - 0.85) / 0.15;
            return `rgb(255,${Math.round(40 + s * 215)},${Math.round(s * 255)})`;
        }
    }

    _drawSGMetrics(ctx, w, h) {
        if (!this.spectrumData) return;
        const sr = this.analyser.context.sampleRate,
            bc = this.spectrumData.length;
        let mb = 1,
            mv = 0;
        for (let i = 1; i < bc; i++)
            if (this.spectrumData[i] > mv) {
                mv = this.spectrumData[i];
                mb = i;
            }
        const pf = (mb * sr) / (bc * 2),
            pd = (mv / 255) * 90 - 90;
        const fl = pf >= 1000 ? (pf / 1000).toFixed(1) + ' kHz' : Math.round(pf) + ' Hz';
        this._metric(
            ctx,
            `Peak: ${isFinite(pd) ? pd.toFixed(1) + ' dBFS' : '-∞'}`,
            w - 4,
            h - 13,
            'right'
        );
        this._metric(ctx, `@ ${fl}`, w - 4, h - 2, 'right');
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  WIREFRAME: 3D mesh perspective (adapted from original visualizer)
    // ══════════════════════════════════════════════════════════════════════════

    _drawWFGrid(ctx, w, _h) {
        ctx.font = '700 8px monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.20)';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText('WIREFRAME', w - 6, 10);
    }

    _drawWireframe(ctx, w, h) {
        this.analyser.getByteFrequencyData(this.spectrumData);

        const rows = this._wfRows; // 8
        const cols = this._wfCols; // 64
        const smooth = this._wfSmooth;
        const totalLen = smooth.length;

        // Update smoothed freq data (α=0.25, same as original)
        for (let i = 0; i < totalLen; i++) {
            const val = i < this.bufferLength ? this.spectrumData[i] / 255 : 0;
            smooth[i] += (val - smooth[i]) * 0.25;
        }

        const colWidth = w / cols;
        const meshHeight = h * 0.6;
        const amplitudeMax = h * 0.28;
        const topMargin = (h - meshHeight) / 2 + amplitudeMax * 0.4;

        // Draw back row first, front row last (painter's algorithm)
        for (let row = rows - 1; row >= 0; row--) {
            const rowOffset = row * 5; // freq offset per row (same as original)
            const depth = row / (rows - 1); // 0=front, 1=back
            const y0 = topMargin + depth * meshHeight;
            const scale = 1 - depth * 0.4; // perspective scale
            const xOffset = (1 - scale) * w * 0.5; // center the shrinking rows
            const alpha = 0.25 + (1 - depth) * 0.75;
            const hue = 260 + row * 15; // purple → violet spectrum

            // ── Line trace ──
            ctx.strokeStyle = `hsla(${hue}, 100%, 65%, ${alpha})`;
            ctx.lineWidth = 1.5;
            ctx.shadowBlur = 4;
            ctx.shadowColor = `hsla(${hue}, 100%, 65%, 0.4)`;
            ctx.beginPath();
            for (let col = 0; col < cols; col++) {
                const idx = Math.min(col + rowOffset, totalLen - 1);
                const val = smooth[idx];
                const x = xOffset + col * colWidth * scale;
                const y = y0 - val * amplitudeMax * scale;
                col === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.shadowBlur = 0;

            // ── Vertex dots (every 3 cols) ──
            ctx.fillStyle = `hsla(${hue}, 100%, 82%, ${alpha * 0.65})`;
            for (let col = 0; col < cols; col += 3) {
                const idx = Math.min(col + rowOffset, totalLen - 1);
                const val = smooth[idx];
                const x = xOffset + col * colWidth * scale;
                const y = y0 - val * amplitudeMax * scale;
                ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
            }

            // ── Vertical connectors to next (deeper) row ──
            if (row < rows - 1) {
                const nDepth = (row + 1) / (rows - 1);
                const nY0 = topMargin + nDepth * meshHeight;
                const nScale = 1 - nDepth * 0.4;
                const nXOffset = (1 - nScale) * w * 0.5;
                const nOffset = (row + 1) * 5;

                ctx.strokeStyle = `hsla(${hue}, 70%, 50%, ${alpha * 0.22})`;
                ctx.lineWidth = 0.5;
                for (let col = 0; col < cols; col += 4) {
                    const i1 = Math.min(col + rowOffset, totalLen - 1);
                    const i2 = Math.min(col + nOffset, totalLen - 1);
                    const x1 = xOffset + col * colWidth * scale;
                    const y1 = y0 - smooth[i1] * amplitudeMax * scale;
                    const x2 = nXOffset + col * colWidth * nScale;
                    const y2 = nY0 - smooth[i2] * amplitudeMax * nScale;
                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.stroke();
                }
            }
        }
    }

    _drawWFMetrics(ctx, w, h) {
        if (!this.spectrumData) return;
        const sr = this.analyser.context.sampleRate,
            bc = this.spectrumData.length;
        let mb = 1,
            mv = 0;
        for (let i = 1; i < bc; i++)
            if (this.spectrumData[i] > mv) {
                mv = this.spectrumData[i];
                mb = i;
            }
        const pf = (mb * sr) / (bc * 2),
            pd = (mv / 255) * 90 - 90;
        const fl = pf >= 1000 ? (pf / 1000).toFixed(1) + ' kHz' : Math.round(pf) + ' Hz';
        this._metric(
            ctx,
            `Peak: ${isFinite(pd) ? pd.toFixed(1) + ' dBFS' : '-∞'} @ ${fl}`,
            w - 4,
            h - 4,
            'right'
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  LEVEL HISTORY: scrolling Peak + RMS graph
    // ══════════════════════════════════════════════════════════════════════════

    _drawLHGrid(ctx, w, h) {
        ctx.font = '8px monospace';
        ctx.lineWidth = 0.5;
        const dBs = [0, -6, -12, -18, -24, -36, -48, -60];
        const padL = 28,
            usableH = h - 10;
        for (const db of dBs) {
            const y = usableH * (1 - (db + 90) / 90) + 5;
            ctx.strokeStyle =
                db === 0
                    ? 'rgba(255,80,80,0.25)'
                    : db >= -6
                      ? 'rgba(255,200,0,0.15)'
                      : 'rgba(255,255,255,0.06)';
            ctx.lineWidth = db === 0 ? 1 : 0.5;
            ctx.beginPath();
            ctx.moveTo(padL, y);
            ctx.lineTo(w, y);
            ctx.stroke();
            ctx.fillStyle = db === 0 ? 'rgba(255,120,120,0.55)' : 'rgba(255,255,255,0.25)';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(db === 0 ? '0' : String(db), padL - 3, y);
        }
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText('dBFS', 2, h);
    }

    _drawLevelHistory(ctx, w, h) {
        this.analyser.getByteTimeDomainData(this.timeData);
        const len = this.timeData.length;
        let rmsSum = 0,
            peakLin = 0;
        for (let i = 0; i < len; i++) {
            const v = Math.abs(this.timeData[i] / 128 - 1);
            rmsSum += v * v;
            if (v > peakLin) peakLin = v;
        }
        const rmsLin = Math.sqrt(rmsSum / len);

        // Push to circular buffer
        this._lhBuf[this._lhHead] = { peak: peakLin, rms: rmsLin };
        this._lhHead = (this._lhHead + 1) % this._lhLen;

        const padL = 28,
            usableW = w - padL - 4,
            usableH = h - 10,
            top = 5;
        const dbToY = (db) => top + usableH * (1 - (db + 90) / 90);

        // Draw Peak filled area
        ctx.beginPath();
        let firstPt = true;
        for (let i = 0; i < this._lhLen; i++) {
            const entry = this._lhBuf[(this._lhHead + i) % this._lhLen];
            const x = padL + (i / this._lhLen) * usableW;
            const db = this._linToDb(entry.peak);
            const y = isFinite(db) ? dbToY(db) : top + usableH;
            if (firstPt) {
                ctx.moveTo(x, y);
                firstPt = false;
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.lineTo(padL + usableW, top + usableH);
        ctx.lineTo(padL, top + usableH);
        ctx.closePath();
        const gradP = ctx.createLinearGradient(0, top, 0, top + usableH);
        gradP.addColorStop(0, 'rgba(220,80,80,0.30)');
        gradP.addColorStop(0.5, 'rgba(180,100,200,0.15)');
        gradP.addColorStop(1, 'rgba(60,60,180,0.05)');
        ctx.fillStyle = gradP;
        ctx.fill();

        // Peak line
        ctx.beginPath();
        firstPt = true;
        for (let i = 0; i < this._lhLen; i++) {
            const entry = this._lhBuf[(this._lhHead + i) % this._lhLen];
            const x = padL + (i / this._lhLen) * usableW;
            const db = this._linToDb(entry.peak);
            const y = isFinite(db) ? dbToY(Math.max(-90, db)) : top + usableH;
            if (firstPt) {
                ctx.moveTo(x, y);
                firstPt = false;
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.strokeStyle = 'rgba(200,100,220,0.75)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // RMS line
        ctx.beginPath();
        firstPt = true;
        for (let i = 0; i < this._lhLen; i++) {
            const entry = this._lhBuf[(this._lhHead + i) % this._lhLen];
            const x = padL + (i / this._lhLen) * usableW;
            const db = this._linToDb(entry.rms);
            const y = isFinite(db) ? dbToY(Math.max(-90, db)) : top + usableH;
            if (firstPt) {
                ctx.moveTo(x, y);
                firstPt = false;
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.strokeStyle = 'rgba(89,162,140,0.80)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    _drawLHMetrics(ctx, w, _h) {
        if (!this.timeData) return;
        let rmsSum = 0,
            peakLin = 0;
        for (let i = 0; i < this.timeData.length; i++) {
            const v = Math.abs(this.timeData[i] / 128 - 1);
            rmsSum += v * v;
            if (v > peakLin) peakLin = v;
        }
        const peakDb = this._linToDb(peakLin),
            rmsDb = this._linToDb(Math.sqrt(rmsSum / this.timeData.length));
        const pad = 4;
        this._metric(ctx, '━ Peak', w - pad, 10, 'right', 'rgba(200,100,220,0.90)');
        this._metric(ctx, '━ RMS', w - pad, 21, 'right', 'rgba(89,162,140,0.90)');
        this._metric(
            ctx,
            `Peak: ${isFinite(peakDb) ? peakDb.toFixed(1) + ' dBFS' : '-∞'}`,
            w - pad,
            32,
            'right'
        );
        this._metric(
            ctx,
            `RMS:  ${isFinite(rmsDb) ? rmsDb.toFixed(1) + ' dBFS' : '-∞'}`,
            w - pad,
            43,
            'right'
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  M/S SCOPE: Mid (sustained) vs Side (transient flux)
    // ══════════════════════════════════════════════════════════════════════════

    _drawMSScope(ctx, w, h) {
        this.analyser.getByteFrequencyData(this.spectrumData);
        const binCount = this.spectrumData.length,
            sampleRate = this.analyser.context.sampleRate,
            numBars = 200;

        // Update slow-smoothed average (Mid proxy: α=0.04 → very slow)
        // Side = |current - Mid| (spectral flux = transient content)
        const ALPHA_MID = 0.06;

        for (let b = 0; b < binCount; b++) {
            this._msAvg[b] =
                this._msAvg[b] * (1 - ALPHA_MID) + (this.spectrumData[b] / 255) * ALPHA_MID;
        }

        for (let i = 0; i < numBars; i++) {
            const f0 = 20 * Math.pow(20000 / 20, i / numBars),
                f1 = 20 * Math.pow(20000 / 20, (i + 1) / numBars);
            const b0 = Math.max(0, Math.floor((f0 * binCount * 2) / sampleRate));
            const b1 = Math.min(binCount - 1, Math.ceil((f1 * binCount * 2) / sampleRate));
            let mxCur = 0,
                mxAvg = 0;
            for (let b = b0; b <= b1; b++) {
                if (this.spectrumData[b] / 255 > mxCur) mxCur = this.spectrumData[b] / 255;
                if (this._msAvg[b] > mxAvg) mxAvg = this._msAvg[b];
            }
            const side = Math.max(0, mxCur - mxAvg); // transient = current above average

            const x = this._freqToX(f0, w),
                barW = Math.max(1, this._freqToX(f1, w) - x - 0.5);

            // Mid bar (blue: sustained energy)
            const midH = mxAvg * h * 0.92;
            ctx.fillStyle = 'rgba(55,130,210,0.55)';
            ctx.fillRect(x, h - midH, barW, midH);

            // Side bar on top (purple: transient flux)
            const sideH = side * h * 0.92;
            if (sideH > 1) {
                ctx.fillStyle = 'rgba(200,80,240,0.80)';
                ctx.fillRect(x, h - midH - sideH, barW, sideH);
            }

            // Peak line (combined)
            const totalH = mxCur * h * 0.92;
            if (totalH > 2) {
                ctx.fillStyle = 'rgba(220,180,255,0.70)';
                ctx.fillRect(x, h - totalH - 1, barW, 1);
            }
        }
    }

    _drawMSMetrics(ctx, w, _h) {
        if (!this.spectrumData || !this._msAvg) return;
        const bc = this.spectrumData.length;
        let energyMid = 0,
            energySide = 0;
        for (let b = 0; b < bc; b++) {
            const cur = this.spectrumData[b] / 255,
                avg = this._msAvg[b];
            energyMid += avg * avg;
            energySide += Math.max(0, cur - avg) ** 2;
        }
        const rMid = Math.sqrt(energyMid / bc),
            rSide = Math.sqrt(energySide / bc);
        const dbMid = this._linToDb(rMid),
            dbSide = this._linToDb(rSide);
        const pad = 4;
        this._metric(ctx, '━ Mid (sustained)', w - pad, 10, 'right', 'rgba(100,170,255,0.90)');
        this._metric(ctx, '━ Side (transient)', w - pad, 21, 'right', 'rgba(200,80,240,0.90)');
        this._metric(
            ctx,
            `Mid:  ${isFinite(dbMid) ? dbMid.toFixed(1) + ' dB' : '-∞'}`,
            w - pad,
            32,
            'right'
        );
        this._metric(
            ctx,
            `Side: ${isFinite(dbSide) ? dbSide.toFixed(1) + ' dB' : '-∞'}`,
            w - pad,
            43,
            'right'
        );
    }
}
