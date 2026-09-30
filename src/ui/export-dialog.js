/**
 * The export window.
 *
 * Two tabs over one button: an audio tab that renders the song and encodes
 * it, and a MIDI tab that writes the notes. Which one the Export button
 * acts on is whichever tab is in front: the only piece of state this
 * window has that is not a form control.
 *
 * It drives the markup in `app-shell.html` rather than building a window
 * of its own, which is how every other window in the studio works. Doing
 * so turned out to be worth more than tidiness: half the controls in that
 * markup map onto settings the exporter has always accepted and the old
 * hand-built window never offered: exporting one chosen pattern, and
 * every option the MIDI writer takes.
 *
 * What the markup offers and this build cannot do is hidden rather than
 * deleted, the same treatment the community chips get. Four of the five
 * format buttons have no encoder behind them; MIDI type 0 is written
 * without a tempo, so it would import at whatever the receiving program
 * defaults to; and the Code and Player tabs generate an embeddable player
 * that has never existed here. Each is a decision recorded in
 * `docs/licensing.md` or in a comment beside it, and the markup is where
 * they come back from.
 *
 * The one thing that must not be lost in the move: the format list is
 * built from the encoder registry, not from the markup's five buttons. A
 * build that registers FLAC offers FLAC, and one that strips an encoder
 * offers one format fewer, which is the promise `encoders.js` is written
 * around.
 */

import { Exporter, DEFAULT_TRACK_NAMES, getExportPatterns } from '../export/exporter.js';
import { hasEncoder, getEncoder } from '../export/encoders.js';
import { generateMidiBlob } from '../export/midi.js';
import { estimateDuration } from '../export/render.js';
import { resolveExportFilename, abbreviateScale } from '../export/filename.js';
import { translateOr } from '../i18n/i18n.js';

/** The formats the markup has a button for, and the encoder each needs. */
const FORMAT_BUTTONS = Object.freeze({
    fmtWav: 'wav',
    fmtMp3: 'mp3',
    fmtFlac: 'flac',
    fmtAiff: 'aiff',
    fmtOgg: 'ogg'
});

/**
 * Which quality panel belongs to which format.
 *
 * AIFF shares the WAV panel because it asks the same two questions: how
 * often the sound was measured and how finely: and the answers mean the
 * same thing in both files.
 */
const QUALITY_PANELS = Object.freeze({
    wav: 'wavQuality',
    aiff: 'wavQuality',
    mp3: 'mp3Quality',
    flac: 'flacQuality',
    ogg: 'oggQuality'
});

const PATTERN_LETTERS = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);

/** A WAV is two channels of interleaved PCM behind a fixed header. */
const WAV_HEADER_BYTES = 44;
const WAV_CHANNELS = 2;
/** What `render.js` leaves after the last note, unless the export loops. */
const RELEASE_TAIL_SECONDS = 1;

export class ExportDialog {
    /**
     * @param {object} options
     * @param {ParentNode} options.root
     * @param {import('../studio.js').Studio} options.studio
     * @param {import('../platform/index.js').Platform} options.platform
     * @param {() => object} [options.context]  naming, read at export time
     */
    constructor({ root, studio, platform, context = () => ({}) }) {
        this.root = root;
        this.studio = studio;
        this.platform = platform;
        this.context = context;

        this._busy = false;
    }

    bind() {
        this._element = this.root.querySelector('#exportModal');
        if (!this._element) return;

        this._fields = {
            formats: this._el('exportFormatGroup'),
            formatDesc: this._el('exportFormatDesc'),
            sampleRate: this._el('wavSampleRate'),
            bitDepth: this._el('wavBitDepth'),
            normalize: this._el('exportNormalize'),
            loopReady: this._el('exportLoopReady'),
            loopReadyHint: this._el('loopReadyHint'),
            loopPoints: this._el('exportLoopPoints'),
            loopPointsHint: this._el('loopPointsHint'),
            loopPointsText: this._el('loopPointsText'),
            patternOptions: this._el('patternModeOptions'),
            patternSelector: this._el('patternSelector'),
            modeDesc: this._el('exportModeDesc'),
            summary: this._el('exportInfoSummary'),
            duration: this._el('exportInfoDuration'),
            size: this._el('exportInfoSize'),
            progress: this._el('exportProgress'),
            progressLabel: this._el('exportProgressLabel'),
            progressPct: this._el('exportProgressPct'),
            progressBar: this._el('exportProgressBar'),
            status: this._el('exportStatus'),
            start: this._el('exportStartBtn'),
            midiTrackSelector: this._el('midiTrackSelector'),
            midiPatternSelector: this._el('midiPatternSelector'),
            midiFixedVelPanel: this._el('midiFixedVelPanel'),
            midiFixedVelocity: this._el('midiFixedVelocity'),
            midiFixedVelValue: this._el('midiFixedVelValue')
        };

        this._hideFormatsWithoutEncoders();
        this._bindAudio();
        this._bindMidi();

        // Which tab is in front decides what the Export button does, so
        // the summary beneath it has to follow: a MIDI export is always
        // one file, whatever the audio tab was set to.
        for (const tab of this._element.querySelectorAll('[data-bs-toggle="tab"]')) {
            tab.addEventListener('shown.bs.tab', () => this._refresh());
        }

        this._fields.start?.addEventListener('click', () => this._run());
        // Clearing on `show` rather than in `open()` covers the window
        // however it was opened, including from a `data-bs-toggle` button.
        this._element.addEventListener('show.bs.modal', () => this._clearProgress());
        this._element.addEventListener('shown.bs.modal', () => this._refresh());
    }

    open() {
        if (!this._element || !window.bootstrap) return;

        this._refresh();
        window.bootstrap.Modal.getOrCreateInstance(this._element).show();
    }

    /**
     * Put the window back to before anything was exported.
     *
     * A bar left at 100 % and a line reading "Export failed" belong to the
     * run that is over. Reopened, they describe the run that has not started,
     * and the most likely reading of a full bar is that nothing is happening
     * because it is already done.
     */
    _clearProgress() {
        this._fields.progress?.classList.add('d-none');
        if (this._fields.progressBar) this._fields.progressBar.style.width = '0%';
        if (this._fields.progressPct) this._fields.progressPct.textContent = '0%';
        if (this._fields.progressLabel) this._fields.progressLabel.textContent = '';
        if (this._fields.status) this._fields.status.textContent = '';
    }

    close() {
        if (!this._element) return;
        window.bootstrap?.Modal.getOrCreateInstance(this._element).hide();
    }

    // ── Wiring ───────────────────────────────────────────────────────────

    _el(id) {
        return this.root.querySelector(`#${id}`);
    }

    /**
     * A format button with no encoder behind it is taken off the window.
     *
     * The markup names five; this build registers one. Left on, picking
     * MP3 would render the whole song (seconds of work) and only then
     * throw from the encoder, which is the worst order to fail in.
     */
    _hideFormatsWithoutEncoders() {
        for (const [id, format] of Object.entries(FORMAT_BUTTONS)) {
            const available = hasEncoder(format);
            const button = this._el(id);
            if (button) button.disabled = !available;

            // `.btn-check` inputs are invisible by design; the label is
            // what is on screen.
            this._element
                .querySelector(`label[for="${id}"]`)
                ?.classList.toggle('d-none', !available);

            if (
                button &&
                available &&
                !this._element.querySelector('[name="exportFormat"]:checked')
            ) {
                button.checked = true;
            }
        }

        // With one format left the chooser is a caption, not a choice.
        const live = Object.values(FORMAT_BUTTONS).filter((format) => hasEncoder(format));
        this._fields.formats?.parentElement?.classList.toggle('d-none', live.length < 2);
    }

    _bindAudio() {
        for (const id of Object.keys(FORMAT_BUTTONS)) {
            this._el(id)?.addEventListener('change', () => this._refresh());
        }
        for (const id of ['modeFullMix', 'modeStems', 'modePatterns', 'patAll', 'patSingle']) {
            this._el(id)?.addEventListener('change', () => this._refresh());
        }
        for (const id of ['wavSampleRate', 'wavBitDepth', 'exportNormalize', 'exportLoopReady', 'exportLoopPoints']) {
            this._el(id)?.addEventListener('change', () => this._refresh());
        }

        pickOne(this._element, '.export-pat-btn', () => this._refresh());
    }

    _bindMidi() {
        for (const id of ['midiModeAll', 'midiModeSingle']) {
            this._el(id)?.addEventListener('change', () => this._refresh());
        }
        for (const id of ['midiPatAll', 'midiPatSingle', 'midiVelocityMode']) {
            this._el(id)?.addEventListener('change', () => this._refresh());
        }

        this._fields.midiFixedVelocity?.addEventListener('input', () => {
            if (this._fields.midiFixedVelValue) {
                this._fields.midiFixedVelValue.textContent = this._fields.midiFixedVelocity.value;
            }
        });

        pickOne(this._element, '.midi-pat-btn', () => this._refresh());
    }

    // ── Reading the window ───────────────────────────────────────────────

    /** Which tab the Export button acts on. */
    get _tab() {
        return this._element?.querySelector('#exportMidiTab')?.classList.contains('active')
            ? 'midi'
            : 'audio';
    }

    get _settings() {
        const format = this._element.querySelector('[name="exportFormat"]:checked')?.value ?? 'wav';
        const mode =
            this._element.querySelector('[name="exportMode"]:checked')?.value ?? 'full-mix';
        const scope = this._element.querySelector('[name="patternScope"]:checked')?.value ?? 'all';

        return {
            format,
            mode,
            // The selects hold strings, and `encodeWav` checks its bit
            // depth against the numbers 16, 24 and 32 with `includes`:
            // a string gets past the control and throws mid-export.
            sampleRate: Number(this._fields.sampleRate?.value ?? 44100),
            bitDepth: Number(this._fields.bitDepth?.value ?? 16),
            normalize: Boolean(this._fields.normalize?.checked),
            loopReady: Boolean(this._fields.loopReady?.checked),
            loopPoints: Boolean(this._fields.loopPoints?.checked),

            // What each compressed format asks for. Gathered whatever the
            // chosen format is, because the encoder reads only its own and
            // a branch here would be a branch to keep in step with three.
            bitrate: Number(this._el('mp3Bitrate')?.value ?? 320),
            vbr: Boolean(this._el('mp3VBR')?.checked),
            quality: Number(this._el('oggQualitySlider')?.value ?? 8),
            patternScope: scope,
            selectedPattern: chosen(this._element, '.export-pat-btn')
        };
    }

    get _midiOptions() {
        const velocity = this._el('midiVelocityMode')?.value ?? 'dynamic';

        return {
            // `midi.js` compares the format with `===`, so the select's
            // "1" is not 1: the conductor track carrying the tempo and
            // the time signature would be skipped, silently.
            format: Number(this._el('midiFormat')?.value ?? 1),
            ticksPerBeat: Number(this._el('midiTPB')?.value ?? 480),
            includeCC: Boolean(this._el('midiIncludeCC')?.checked),
            velocityMode: velocity,
            fixedVelocity: Number(this._fields.midiFixedVelocity?.value ?? 100)
        };
    }

    // ── Keeping the window honest ────────────────────────────────────────

    /**
     * @param {readonly number[]|null} allowed  null means every depth listed
     */
    _limitBitDepths(allowed) {
        const select = this._fields.bitDepth;
        if (!select) return;

        for (const option of select.options) {
            option.disabled = Boolean(allowed) && !allowed.includes(Number(option.value));
        }

        if (select.selectedOptions[0]?.disabled) {
            const usable = [...select.options].filter((option) => !option.disabled);
            // The deepest one still on offer, so the choice degrades by as
            // little as possible.
            if (usable.length) select.value = usable[usable.length - 1].value;
        }
    }

    _refresh() {
        const settings = this._settings;
        const midi = this._tab === 'midi';

        // Only the panel of the chosen format, and only when its format
        // is the one being exported.
        for (const [format, id] of Object.entries(QUALITY_PANELS)) {
            this._el(id)?.classList.toggle('d-none', format !== settings.format);
        }

        const encoder = getEncoder(settings.format);

        // A depth the chosen format cannot hold is taken off the list rather
        // than accepted and quietly changed: AIFF has no 32-bit float, so
        // the option goes, and a selection sitting on it moves down to 24.
        this._limitBitDepths(encoder?.bitDepths ?? null);

        if (this._fields.formatDesc && encoder) {
            this._fields.formatDesc.textContent = encoder.lossless
                ? translateOr('export.wavdesc', 'Uncompressed PCM audio')
                : encoder.name;
        }

        // What loop-ready does is worth a line, and only while it is on:
        // the markup carries the explanation and nothing ever showed it.
        this._fields.loopReadyHint?.classList.toggle('d-none', !settings.loopReady || settings.loopPoints);
        this._showLoopPoints(settings);

        this._fields.patternOptions?.classList.toggle('d-none', settings.mode !== 'patterns');
        this._fields.patternSelector?.classList.toggle(
            'd-none',
            settings.mode !== 'patterns' || settings.patternScope !== 'single'
        );
        if (this._fields.modeDesc) {
            this._fields.modeDesc.textContent = modeDescription(settings.mode);
        }

        this._fields.midiTrackSelector?.classList.toggle(
            'd-none',
            this._el('midiModeSingle')?.checked !== true
        );
        this._fields.midiPatternSelector?.classList.toggle(
            'd-none',
            this._el('midiPatSingle')?.checked !== true
        );
        this._fields.midiFixedVelPanel?.classList.toggle(
            'd-none',
            this._el('midiVelocityMode')?.value !== 'fixed'
        );

        this._refreshSummary(settings, midi);
    }

    /**
     * Loop points imply loop-ready (a loop has no release tail), and say
     * where the loop will start, or why the chosen format cannot hold one.
     */
    _showLoopPoints(settings) {
        const { loopReady, loopPointsHint: hint, loopPointsText: text } = this._fields;
        if (loopReady) {
            if (settings.loopPoints) loopReady.checked = true;
            loopReady.disabled = settings.loopPoints;
        }
        if (!hint || !text) return;
        hint.classList.toggle('d-none', !settings.loopPoints);
        if (!settings.loopPoints) return;

        const small = hint.querySelector('small');
        const cannot = settings.format === 'mp3' || settings.format === 'aiff';
        small?.classList.toggle('text-info', !cannot);
        small?.classList.toggle('text-warning', cannot);

        if (settings.format === 'mp3') {
            text.textContent = translateOr(
                'export.looppoints.mp3',
                'MP3 cannot loop without a gap: choose OGG, FLAC or WAV for loop points.'
            );
            return;
        }
        if (settings.format === 'aiff') {
            text.textContent = translateOr(
                'export.looppoints.aiff',
                'AIFF files do not get loop points: choose OGG, FLAC or WAV.'
            );
            return;
        }
        if (settings.mode === 'patterns') {
            text.textContent = translateOr('export.looppoints.patterns', 'Each pattern loops whole, from its first sample.');
            return;
        }

        const { sequencer, arrangement } = this.studio;
        const start = arrangement?.loopStart || 0;
        const tags = settings.format === 'wav' ? 'smpl' : 'LOOPSTART / LOOPLENGTH';
        text.textContent = start
            ? translateOr(
                  'export.looppoints.intro',
                  'Written into the file ({tags}), in samples: the intro plays once, then the song loops from measure {measure} ({time}).',
                  { tags, measure: start + 1, time: formatDuration(estimateDuration(sequencer, start)) }
              )
            : translateOr(
                  'export.looppoints.whole',
                  'Written into the file ({tags}), in samples: the whole song loops. To keep an intro out of the loop, choose where the loop starts in the arrangement.',
                  { tags }
              );
    }

    _refreshSummary(settings, midi) {
        const { sequencer } = this.studio;
        const measures = this._measures(settings).length;
        // The render leaves a second of release after the last note,
        // unless the export is meant to loop.
        const seconds =
            estimateDuration(sequencer, measures) +
            (settings.loopReady || settings.loopPoints ? 0 : RELEASE_TAIL_SECONDS);

        const files = midi ? 1 : this._fileCount(settings);

        if (this._fields.summary) {
            // Two labels rather than one sentence, because the markup has
            // two elements for them; `export.duration` already reads as a
            // prefix, and this is written to match.
            this._fields.summary.textContent = `${translateOr('export.files', 'Files: ')}${files}`;
        }
        if (this._fields.duration) {
            this._fields.duration.textContent = `${translateOr(
                'export.duration',
                'Duration: '
            )}${formatDuration(seconds)}`;
        }
        if (this._fields.size) {
            // Exact rather than estimated, for the one encoder this build
            // has: a WAV is a fixed header and then every sample.
            this._fields.size.textContent =
                midi || settings.format !== 'wav'
                    ? '-'
                    : `~${formatBytes(
                          files *
                              (WAV_HEADER_BYTES +
                                  Math.ceil(seconds * settings.sampleRate) *
                                      WAV_CHANNELS *
                                      (settings.bitDepth / 8))
                      )}`;
        }
    }

    /** The measures one exported file covers. */
    _measures(settings) {
        if (settings.mode === 'patterns') return [settings.selectedPattern];
        return getExportPatterns(this.studio.sequencer, this.studio.arrangement);
    }

    _fileCount(settings) {
        if (settings.mode === 'stems') return Math.max(1, this._tracksWithNotes().length);
        if (settings.mode === 'patterns') {
            return settings.patternScope === 'single'
                ? 1
                : Math.max(1, patternsWithNotes(this.studio.sequencer).length);
        }
        return 1;
    }

    _tracksWithNotes() {
        const { sequencer } = this.studio;
        const tracks = [];
        for (let track = 0; track < DEFAULT_TRACK_NAMES.length; track++) {
            if (sequencer.patterns.some((pattern) => pattern[track].some(Boolean))) {
                tracks.push(track);
            }
        }
        return tracks;
    }

    // ── Running ──────────────────────────────────────────────────────────

    async _run() {
        if (this._busy) return;
        this._busy = true;
        if (this._fields.status) this._fields.status.textContent = '';
        this._setProgress(0, translateOr('export.rendering', 'Rendering…'));

        try {
            await this.studio.start();

            const files = this._tab === 'midi' ? [this._exportMidi()] : await this._exportAudio();

            this._setProgress(95, translateOr('export.saving', 'Saving…'));
            await this._save(files);
            this._setProgress(100, translateOr('export.done', 'Done'));
        } catch (error) {
            console.error('[export] failed:', error);
            if (this._fields.status) {
                this._fields.status.textContent = `${translateOr(
                    'export.failed',
                    'Export failed'
                )}: ${error.message}`;
            }
            this._fields.progress?.classList.add('d-none');
        } finally {
            this._busy = false;
        }
    }

    async _exportAudio() {
        const exporter = new Exporter(
            {
                audioEngine: this.studio.audioEngine,
                sequencer: this.studio.sequencer,
                arrangement: this.studio.arrangement,
                masterFx: this.studio.masterFx,
                mastering: this.studio.mastering,
                trackEffects: this.studio.trackEffects,
                fxAutomation: this.studio.fxAutomation,
                mixerAutomation: this.studio.mixerAutomation,
                generator: this.studio.generator
            },
            { settings: this._settings, context: this.context() }
        );

        this._exporter = exporter;
        return exporter.run((stage, progress) => this._setProgress(progress * 0.9, stage));
    }

    _exportMidi() {
        const { sequencer, arrangement, generator, audioEngine } = this.studio;

        const single = this._el('midiPatSingle')?.checked === true;
        const order = single
            ? [chosen(this._element, '.midi-pat-btn')]
            : getExportPatterns(sequencer, arrangement).filter((pattern) => pattern != null);

        const oneTrack = this._el('midiModeSingle')?.checked === true;
        const activeTracks = oneTrack
            ? [Number(this._el('midiTrackSelect')?.value ?? 0)]
            : undefined;

        const blob = generateMidiBlob(
            {
                patterns: sequencer.patterns,
                patternOrder: order.length > 0 ? order : [sequencer.currentPattern],
                steps: sequencer.steps,
                bpm: sequencer.bpm,
                swing: sequencer.swing,
                activeTracks,
                tracks: DEFAULT_TRACK_NAMES.map((name, index) => ({
                    name,
                    volume: audioEngine.tracks[index].volume,
                    pan: audioEngine.mixerSettings[index].pan
                }))
            },
            this._midiOptions
        );

        const context = this.context();
        const name = resolveExportFilename({
            ...context,
            track: oneTrack ? DEFAULT_TRACK_NAMES[activeTracks[0]] : 'FullMix',
            pattern: single ? (PATTERN_LETTERS[order[0]] ?? String(order[0])) : 'All',
            scale: abbreviateScale(generator.rootKey, generator.scaleType),
            bpm: sequencer.bpm,
            ext: 'mid'
        });

        return { name, blob };
    }

    /** One file is saved as itself; several travel as an archive. */
    async _save(files) {
        if (files.length === 1) {
            await this.platform.saveFile(files[0].name, files[0].blob);
            return;
        }

        if (this.platform.id === 'desktop') {
            await this.platform.saveFiles(files);
            return;
        }

        const archive = await this._exporter.toArchive(files, this._settings.mode);
        await this.platform.saveFile(archive.name, archive.blob);
    }

    _setProgress(percent, label) {
        const rounded = Math.round(percent);

        this._fields.progress?.classList.remove('d-none');
        if (this._fields.progressBar) this._fields.progressBar.style.width = `${rounded}%`;
        if (this._fields.progressPct) this._fields.progressPct.textContent = `${rounded}%`;
        if (this._fields.progressLabel) this._fields.progressLabel.textContent = label;
    }
}

/**
 * A row of buttons where one is chosen, as the markup writes them: an
 * `active` class rather than a radio.
 */
function pickOne(root, selector, onPick) {
    for (const button of root.querySelectorAll(selector)) {
        button.addEventListener('click', () => {
            for (const other of root.querySelectorAll(selector)) {
                other.classList.toggle('active', other === button);
            }
            onPick();
        });
    }
}

function chosen(root, selector) {
    return Number(root.querySelector(`${selector}.active`)?.dataset.pattern ?? 0);
}

/** Patterns holding at least one note. */
function patternsWithNotes(sequencer) {
    return sequencer.patterns
        .map((pattern, index) => (pattern.some((track) => track.some(Boolean)) ? index : null))
        .filter((index) => index != null);
}

function modeDescription(mode) {
    if (mode === 'stems') {
        return translateOr('export.stemsdesc', 'One file per track');
    }
    if (mode === 'patterns') {
        return translateOr('export.patternsdesc', 'One file per pattern');
    }
    return translateOr('export.fullmixdesc', 'The complete arrangement as one mixed file');
}

function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const rest = Math.round(seconds % 60);
    return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.round(bytes / 1024)} kB`;
}
