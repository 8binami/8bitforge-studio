import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AudioEngine } from '../src/audio/audio-engine.js';
import { Sequencer } from '../src/sequencer/sequencer.js';
import { Arrangement } from '../src/sequencer/arrangement.js';
import { EventBus } from '../src/core/event-bus.js';
import {
    Exporter,
    getExportPatterns,
    patternsWithContent,
    DEFAULT_TRACK_NAMES
} from '../src/export/exporter.js';
import {
    encodeAudio,
    getEncoder,
    hasEncoder,
    listEncoders,
    registerEncoder,
    unregisterEncoder
} from '../src/export/encoders.js';
import { FakeAudioContext, fakeOfflineContextFactory } from './helpers/fake-audio-context.js';

async function makeStudio() {
    const liveContext = new FakeAudioContext();
    const engine = new AudioEngine({ createContext: () => liveContext });
    await engine.init();

    const bus = new EventBus();
    const sequencer = new Sequencer(engine, { bus });
    const arrangement = new Arrangement(sequencer, { bus });
    sequencer.arrangement = arrangement;

    return { audioEngine: engine, sequencer, arrangement, engine };
}

/** An exporter whose renders go to a fake offline context. */
function makeExporter(studio, options = {}) {
    const exporter = new Exporter(studio, options);
    const contexts = [];
    exporter._render = ({ patterns, tracks = null }) => {
        const record = {};
        contexts.push({ patterns, tracks, record });
        const context = fakeOfflineContextFactory(record)(2, 100, 44100);
        return context.startRendering();
    };
    return { exporter, renders: contexts };
}

describe('encoder registry', () => {
    afterEach(() => {
        unregisterEncoder('test-format');
    });

    it('ships WAV built in', () => {
        expect(hasEncoder('wav')).toBe(true);
        expect(getEncoder('wav')).toMatchObject({
            lossless: true,
            licence: 'AGPL-3.0-or-later'
        });
    });

    it('takes a registered encoder', async () => {
        registerEncoder({
            format: 'test-format',
            extension: 'tst',
            mimeType: 'audio/test',
            encode: () => new Blob(['encoded'])
        });

        expect(listEncoders().map((item) => item.format)).toContain('test-format');

        const buffer = { numberOfChannels: 1, length: 1, sampleRate: 44100 };
        const { extension } = await encodeAudio(buffer, 'test-format');
        expect(extension).toBe('tst');
    });

    it('refuses an encoder missing a field', () => {
        expect(() => registerEncoder({ format: 'broken' })).toThrow(TypeError);
    });

    it('says which formats it has when asked for one it lacks', async () => {
        const buffer = { numberOfChannels: 1, length: 1, sampleRate: 44100 };
        await expect(encodeAudio(buffer, 'flac')).rejects.toThrow(/No encoder for "flac".*wav/s);
    });
});

describe('getExportPatterns', () => {
    let studio;

    beforeEach(async () => {
        studio = await makeStudio();
    });

    it('falls back to pattern 0 for an empty project', () => {
        expect(getExportPatterns(studio.sequencer, studio.arrangement)).toEqual([0]);
    });

    it('takes every pattern that holds notes, once each', () => {
        studio.sequencer.setCell(0, 0, 'C', 4);
        studio.sequencer.switchPattern(3);
        studio.sequencer.setCell(0, 0, 'E', 4);

        expect(getExportPatterns(studio.sequencer, studio.arrangement)).toEqual([0, 3]);
    });

    it('follows the arrangement chain, repeats and silences included', () => {
        studio.sequencer.setCell(0, 0, 'C', 4);
        studio.arrangement.setChain([0, 0, null, 1]);

        expect(getExportPatterns(studio.sequencer, studio.arrangement)).toEqual([0, 0, null, 1]);
    });

    it('ignores a chain of nothing but silence', () => {
        studio.sequencer.setCell(0, 0, 'C', 4);
        studio.arrangement.setChain([null, null]);

        expect(getExportPatterns(studio.sequencer, studio.arrangement)).toEqual([0]);
    });

    it('lists the patterns holding content', () => {
        studio.sequencer.switchPattern(2);
        studio.sequencer.setCell(1, 3, 'G', 4);

        expect(patternsWithContent(studio.sequencer)).toEqual([2]);
    });
});

describe('Exporter full mix', () => {
    let studio;

    beforeEach(async () => {
        studio = await makeStudio();
        studio.sequencer.setCell(0, 0, 'C', 4);
    });

    it('produces one file', async () => {
        const { exporter } = makeExporter(studio, {
            context: { project: 'MyTrack', designer: 'Dbenkei', template: '%Project%_%Track%' }
        });

        const files = await exporter.run();

        expect(files).toHaveLength(1);
        expect(files[0].name).toBe('MyTrack_FullMix.wav');
        expect(files[0].blob.type).toBe('audio/wav');
    });

    it('renders the arrangement chain', async () => {
        studio.arrangement.setChain([0, 0, 1]);
        const { exporter, renders } = makeExporter(studio);

        await exporter.run();

        expect(renders[0].patterns).toEqual([0, 0, 1]);
        expect(renders[0].tracks).toBeNull();
    });

    it('reports its progress', async () => {
        const { exporter } = makeExporter(studio);
        const stages = [];

        await exporter.run((stage, progress) => stages.push([stage, progress]));

        expect(stages[0][0]).toBe('Rendering');
        expect(stages.at(-1)[1]).toBeGreaterThan(stages[0][1]);
    });
});

describe('Exporter stems', () => {
    let studio;

    beforeEach(async () => {
        studio = await makeStudio();
        studio.sequencer.setCell(0, 0, 'C', 4); // lead
        studio.sequencer.setCell(4, 0, 'C', 2); // kick
    });

    it('renders one file per track that has notes', async () => {
        const { exporter, renders } = makeExporter(studio, {
            settings: { mode: 'stems' },
            context: { template: '%Track%' }
        });

        const files = await exporter.run();

        expect(files.map((file) => file.name)).toEqual(['Lead.wav', 'Kick.wav']);
        expect(renders.map((render) => render.tracks)).toEqual([[0], [4]]);
    });

    it('leaves silent tracks out', async () => {
        const { exporter } = makeExporter(studio, { settings: { mode: 'stems' } });
        const files = await exporter.run();

        expect(files).toHaveLength(2);
        expect(DEFAULT_TRACK_NAMES).toHaveLength(8);
    });

    it('bundles the files into an archive', async () => {
        const { exporter } = makeExporter(studio, {
            settings: { mode: 'stems' },
            context: { project: 'MyTrack', template: '%Project%_%Track%' }
        });

        const files = await exporter.run();
        const archive = await exporter.toArchive(files, 'stems');

        expect(archive.name).toBe('MyTrack_stems.zip');
        expect(archive.blob.type).toBe('application/zip');
        expect(archive.blob.size).toBeGreaterThan(0);
    });
});

describe('Exporter patterns', () => {
    let studio;

    beforeEach(async () => {
        studio = await makeStudio();
        studio.sequencer.setCell(0, 0, 'C', 4);
        studio.sequencer.switchPattern(2);
        studio.sequencer.setCell(0, 0, 'E', 4);
    });

    it('renders one file per pattern, named by its letter', async () => {
        const { exporter, renders } = makeExporter(studio, {
            settings: { mode: 'patterns' },
            context: { template: 'Pattern-%Pattern%' }
        });

        const files = await exporter.run();

        expect(files.map((file) => file.name)).toEqual(['Pattern-A.wav', 'Pattern-C.wav']);
        expect(renders.map((render) => render.patterns)).toEqual([[0], [2]]);
    });

    it('gives every pattern a name of its own under the default template', async () => {
        // The default template has no %Pattern% token and the only other
        // varying part is a timestamp accurate to the second, which an
        // offline render of sixteen steps finishes well inside. Before
        // this, exporting eight patterns wrote eight identical names:
        // one file on the desktop, duplicate entries in an archive.
        const { exporter } = makeExporter(studio, { settings: { mode: 'patterns' } });

        const files = await exporter.run();
        const names = files.map((file) => file.name);

        expect(names).toHaveLength(2);
        expect(new Set(names).size).toBe(2);
        expect(names[0]).toContain('_A.');
        expect(names[1]).toContain('_C.');
    });

    it('does not repeat the letter when the template already places it', async () => {
        const { exporter } = makeExporter(studio, {
            settings: { mode: 'patterns' },
            context: { template: '%Pattern%-song' }
        });

        expect((await exporter.run()).map((file) => file.name)).toEqual([
            'A-song.wav',
            'C-song.wav'
        ]);
    });

    it('renders just the one that was asked for', async () => {
        const { exporter, renders } = makeExporter(studio, {
            settings: { mode: 'patterns', patternScope: 'single', selectedPattern: 2 }
        });

        await exporter.run();

        expect(renders).toHaveLength(1);
        expect(renders[0].patterns).toEqual([2]);
    });
});

describe('Exporter stems', () => {
    it('gives every stem a name of its own under the default template', async () => {
        const studio = await makeStudio();
        studio.sequencer.setCell(0, 0, 'C', 4);
        studio.sequencer.setCell(2, 4, 'C', 2);

        const { exporter } = makeExporter(studio, { settings: { mode: 'stems' } });
        const names = (await exporter.run()).map((file) => file.name);

        // The default template does carry %Track%, so the names differ on
        // their own and nothing is appended twice.
        expect(names).toHaveLength(2);
        expect(new Set(names).size).toBe(2);
        expect(names.every((name) => !/_(Lead|Bass)_.*_(Lead|Bass)\./.test(name))).toBe(true);
    });

    it('still tells stems apart when the template drops the track', async () => {
        const studio = await makeStudio();
        studio.sequencer.setCell(0, 0, 'C', 4);
        studio.sequencer.setCell(2, 4, 'C', 2);

        const { exporter } = makeExporter(studio, {
            settings: { mode: 'stems' },
            context: { template: 'song' }
        });

        expect((await exporter.run()).map((file) => file.name)).toEqual([
            'song_Lead.wav',
            'song_Bass.wav'
        ]);
    });
});

describe('Exporter settings', () => {
    it('refuses an unknown mode', async () => {
        const studio = await makeStudio();
        const { exporter } = makeExporter(studio, { settings: { mode: 'sideways' } });

        await expect(exporter.run()).rejects.toThrow(/Unknown export mode/);
    });

    it('describes the chosen format', async () => {
        const studio = await makeStudio();
        const { exporter } = makeExporter(studio);

        expect(exporter.getFormatInfo()).toMatchObject({ name: 'WAV', lossless: true });
        expect(exporter.getFormatInfo('flac')).toBeNull();
    });

    it('puts the tempo and key in the file name', async () => {
        const studio = await makeStudio();
        studio.sequencer.setBPM(140);
        studio.generator = { rootKey: 'D', scaleType: 'minor' };

        const { exporter } = makeExporter(studio, {
            context: { template: '%Scale%_%BPM%bpm' }
        });
        const [file] = await exporter.run();

        expect(file.name).toBe('Dmin_140bpm.wav');
    });
});
