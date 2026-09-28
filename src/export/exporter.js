/**
 * Export orchestration.
 *
 * Turns a project into files: render, encode, name. It produces the files and
 * stops there: saving them is the platform's job, so the same code serves a
 * download in the browser and a folder on disk in the desktop app.
 *
 * Three modes:
 *   full-mix  the arrangement, mixed down to one file
 *   stems     one file per track, solo and mute ignored
 *   patterns  one file per pattern that has something in it
 */

import { encodeAudio, getEncoder } from './encoders.js';
import { renderSong } from './render.js';
import { resolveExportFilename, abbreviateScale, DEFAULT_TEMPLATE } from './filename.js';
import { createZipBlob } from './zip.js';

const TRACK_COUNT = 8;

export const DEFAULT_TRACK_NAMES = [
    'Lead',
    'Harmony',
    'Bass',
    'Arp',
    'Kick',
    'Snare',
    'HiHat',
    'FX'
];

export const EXPORT_DEFAULTS = Object.freeze({
    format: 'wav',
    mode: 'full-mix',
    sampleRate: 44100,
    bitDepth: 16,
    normalize: true,
    loopReady: false,
    patternScope: 'all', // patterns mode: all, or the selected one
    selectedPattern: 0
});

/**
 * The measures a full mix covers: the arrangement chain when there is one,
 * otherwise every pattern holding notes, once each.
 *
 * @param {import('../sequencer/sequencer.js').Sequencer} sequencer
 * @param {object|null} [arrangement]
 * @returns {Array<number|null>}
 */
export function getExportPatterns(sequencer, arrangement = null) {
    const chain = arrangement?.getChain?.() ?? [];
    // Null entries are silent measures and are kept; a chain of nothing but
    // silence is not a song, so it falls through to the patterns themselves.
    if (chain.length > 0 && chain.some((measure) => measure != null)) return chain;

    const filled = patternsWithContent(sequencer);
    return filled.length > 0 ? filled : [0];
}

/** @returns {number[]} indices of the patterns that hold at least one note */
export function patternsWithContent(sequencer) {
    const filled = [];
    for (let pattern = 0; pattern < sequencer.patterns.length; pattern++) {
        if (sequencer.patternHasContent(pattern)) filled.push(pattern);
    }
    return filled;
}

/**
 * @typedef {object} ExportContext
 * @property {string} [designer]
 * @property {string} [project]
 * @property {string} [template]
 *
 * @typedef {object} ExportedFile
 * @property {string} name
 * @property {Blob} blob
 */

export class Exporter {
    /**
     * @param {import('./render.js').RenderSources & {arrangement?: object, generator?: object}} sources
     * @param {object} [options]
     * @param {Partial<typeof EXPORT_DEFAULTS>} [options.settings]
     * @param {ExportContext} [options.context]  names used in the file names
     * @param {string[]} [options.trackNames]
     */
    constructor(sources, { settings = {}, context = {}, trackNames = DEFAULT_TRACK_NAMES } = {}) {
        this.sources = sources;
        this.settings = { ...EXPORT_DEFAULTS, ...settings };
        this.context = context;
        this.trackNames = trackNames;
    }

    /**
     * Run the export.
     *
     * @param {(stage: string, progress: number) => void} [onProgress]
     * @returns {Promise<ExportedFile[]>} one file, or several for stems and patterns
     */
    async run(onProgress = null) {
        const { mode } = this.settings;

        if (mode === 'full-mix') return [await this.exportFullMix(onProgress)];
        if (mode === 'stems') return this.exportStems(onProgress);
        if (mode === 'patterns') return this.exportPatterns(onProgress);
        throw new Error(`Unknown export mode: ${mode}`);
    }

    /** @returns {Promise<ExportedFile>} */
    async exportFullMix(onProgress = null) {
        const patterns = getExportPatterns(this.sources.sequencer, this.sources.arrangement);

        onProgress?.('Rendering', 10);
        const buffer = await this._render({ patterns });

        onProgress?.('Encoding', 70);
        return this._encode(buffer, { track: 'FullMix', pattern: 'All' });
    }

    /** One file per track that has something on it. @returns {Promise<ExportedFile[]>} */
    async exportStems(onProgress = null) {
        const patterns = getExportPatterns(this.sources.sequencer, this.sources.arrangement);
        const tracks = this._tracksWithContent(patterns);
        const files = [];

        for (const [index, track] of tracks.entries()) {
            onProgress?.(`Rendering ${this.trackNames[track]}`, 10 + (index / tracks.length) * 80);
            const buffer = await this._render({ patterns, tracks: [track] });
            files.push(
                await this._encode(
                    buffer,
                    { track: this.trackNames[track], pattern: 'All' },
                    { varyBy: 'Track' }
                )
            );
        }

        onProgress?.('Done', 100);
        return files;
    }

    /** One file per pattern. @returns {Promise<ExportedFile[]>} */
    async exportPatterns(onProgress = null) {
        const patterns =
            this.settings.patternScope === 'single'
                ? [this.settings.selectedPattern]
                : patternsWithContent(this.sources.sequencer);

        const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
        const files = [];

        for (const [index, pattern] of patterns.entries()) {
            onProgress?.(
                `Rendering pattern ${letters[pattern]}`,
                10 + (index / patterns.length) * 80
            );
            const buffer = await this._render({ patterns: [pattern] });
            files.push(
                await this._encode(
                    buffer,
                    { track: 'FullMix', pattern: letters[pattern] ?? pattern },
                    { varyBy: 'Pattern' }
                )
            );
        }

        onProgress?.('Done', 100);
        return files;
    }

    /**
     * Bundle several files into one archive, named from the same template.
     * @param {ExportedFile[]} files
     * @param {string} label  what the archive is, such as "stems"
     * @returns {Promise<ExportedFile>}
     */
    async toArchive(files, label) {
        const blob = await createZipBlob(
            files.map((file) => ({ name: file.name, blob: file.blob }))
        );
        return { name: this._filename({ track: label, pattern: 'All', ext: 'zip' }), blob };
    }

    /** What the interface should say a format is. */
    getFormatInfo(format = this.settings.format) {
        const encoder = getEncoder(format);
        if (!encoder) return null;
        return {
            format: encoder.format,
            name: encoder.name,
            extension: encoder.extension,
            lossless: encoder.lossless,
            licence: encoder.licence
        };
    }

    // ── Internals ────────────────────────────────────────────────────────

    _render({ patterns, tracks = null }) {
        return renderSong(this.sources, {
            patterns,
            tracks,
            sampleRate: this.settings.sampleRate,
            normalize: this.settings.normalize,
            loopReady: this.settings.loopReady
        });
    }

    async _encode(buffer, naming, options = {}) {
        const { blob, extension } = await encodeAudio(buffer, this.settings.format, this.settings);
        return { name: this._filename({ ...naming, ext: extension }, options), blob };
    }

    /** Tracks holding at least one note across the measures being exported. */
    _tracksWithContent(patterns) {
        const { sequencer } = this.sources;
        const tracks = [];

        for (let track = 0; track < TRACK_COUNT; track++) {
            const used = patterns.some((patternIndex) => {
                if (patternIndex == null) return false;
                return sequencer.patterns[patternIndex]?.[track]?.some(Boolean);
            });
            if (used) tracks.push(track);
        }
        return tracks;
    }

    /**
     * A name for one file, distinct from the others in its batch.
     *
     * The template belongs to the user and may leave out the very thing
     * that tells a batch apart. The default one has no `%Pattern%`, so
     * exporting eight patterns resolved to eight identical names: and
     * the only other varying part, the timestamp, is accurate to the
     * second, which an offline render of sixteen steps finishes well
     * inside. On the desktop the later files overwrote the earlier ones
     * and "one file per pattern" delivered one file; in an archive they
     * became duplicate entries.
     *
     * So whatever a batch varies by is appended when the template does
     * not already carry it. A single file varies by nothing and is named
     * exactly as the template says.
     *
     * @param {object} naming
     * @param {object} [options]
     * @param {'Track'|'Pattern'|null} [options.varyBy]  what differs
     *   between the files of this batch
     */
    _filename(naming, { varyBy = null } = {}) {
        const { sequencer, generator } = this.sources;
        const template = this.context.template || DEFAULT_TEMPLATE;

        const name = resolveExportFilename({
            template: this.context.template,
            designer: this.context.designer,
            project: this.context.project,
            scale: generator ? abbreviateScale(generator.rootKey, generator.scaleType) : '',
            bpm: sequencer.bpm,
            ...naming
        });

        if (!varyBy || template.includes(`%${varyBy}%`)) return name;

        const distinguishing = naming[varyBy.toLowerCase()];
        const dot = name.lastIndexOf('.');
        return dot < 0
            ? `${name}_${distinguishing}`
            : `${name.slice(0, dot)}_${distinguishing}${name.slice(dot)}`;
    }
}
