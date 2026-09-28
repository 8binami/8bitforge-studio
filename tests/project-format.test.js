import { describe, it, expect } from 'vitest';
import {
    createProjectFile,
    parseProjectFile,
    serializeProjectFile,
    readProjectHeader,
    toFileName,
    ProjectFormatError,
    CURRENT_VERSION,
    FORMAT_ID
} from '../src/project/format.js';

const state = () => ({
    version: '1.2',
    sequencer: { bpm: 120, steps: 16 },
    tracks: [{ volume: 1 }, { volume: 0.5 }]
});

/** A file as written by the legacy web app. */
const legacyFile = () => ({
    format: FORMAT_ID,
    version: '1.4.1',
    name: 'Legacy Track',
    exportedAt: '2026-03-03T14:30:25.000Z',
    data: { version: '1.1', tracks: [{ volume: 1 }, { volume: 0.5 }] }
});

describe('createProjectFile', () => {
    it('builds a complete envelope', () => {
        const file = createProjectFile({ name: 'My Track', data: state() });

        expect(file.format).toBe(FORMAT_ID);
        expect(file.version).toBe(CURRENT_VERSION);
        expect(file.name).toBe('My Track');
        expect(file.category).toBe('custom');
        expect(file.tags).toEqual([]);
        expect(file.cover).toBeNull();
        expect(file.createdAt).toBe(file.updatedAt);
    });

    it('rejects a project without a name or payload', () => {
        expect(() => createProjectFile({ name: '', data: state() })).toThrow(ProjectFormatError);
        expect(() => createProjectFile({ name: 'x', data: null })).toThrow(ProjectFormatError);
    });
});

describe('parseProjectFile', () => {
    it('round-trips a file through serialization', () => {
        const file = createProjectFile({ name: 'Round Trip', data: state(), tags: ['chiptune'] });
        const { file: parsed, migrated } = parseProjectFile(serializeProjectFile(file));

        expect(migrated).toBe(false);
        expect(parsed).toEqual(file);
    });

    it('rejects anything that is not a project', () => {
        expect(() => parseProjectFile('not json')).toThrow(/valid JSON/);
        expect(() => parseProjectFile('[]')).toThrow(/not a project/);
        expect(() => parseProjectFile(JSON.stringify({ format: 'other', version: '2.0' }))).toThrow(
            /Unknown format/
        );
        expect(() => parseProjectFile(JSON.stringify({ format: FORMAT_ID }))).toThrow(/no version/);
        expect(() =>
            parseProjectFile(JSON.stringify({ format: FORMAT_ID, version: '2.0' }))
        ).toThrow(/no data payload/);
    });

    it('refuses a file from a newer build', () => {
        const future = { ...legacyFile(), version: '9.0', data: state() };
        expect(() => parseProjectFile(future)).toThrow(/newer than this build/);
    });

    it('does not mutate its input', () => {
        const raw = legacyFile();
        const snapshot = structuredClone(raw);
        parseProjectFile(raw);
        expect(raw).toEqual(snapshot);
    });
});

describe('migration of legacy files', () => {
    it('upgrades a 1.x envelope and reports it', () => {
        const { file, migrated, fromVersion } = parseProjectFile(legacyFile());

        expect(migrated).toBe(true);
        expect(fromVersion).toBe('1.4.1');
        expect(file.version).toBe(CURRENT_VERSION);
        expect(file.category).toBe('custom');
        expect(file.tags).toEqual([]);
        expect(file.meta).toEqual({});
        expect(file.cover).toBeNull();
        expect(file.exportedAt).toBeUndefined();
        // exportedAt becomes the creation date
        expect(file.createdAt).toBe('2026-03-03T14:30:25.000Z');
    });

    it('rebalances oscillator volumes from state v1.1 to v1.2', () => {
        const { file } = parseProjectFile(legacyFile());

        expect(file.data.version).toBe('1.2');
        expect(file.data.tracks[0].volume).toBe(0.6);
        expect(file.data.tracks[1].volume).toBe(0.3);
    });

    it('leaves an up-to-date payload untouched', () => {
        const file = createProjectFile({ name: 'Current', data: state() });
        const { file: parsed } = parseProjectFile(file);
        expect(parsed.data.tracks[0].volume).toBe(1);
    });

    it('finds the per-track effects under the name the legacy app used', () => {
        // The live app writes them as `trackFx` and this build reads
        // `trackEffects`. The records inside are the same object field
        // for field, so only the name differs - and without the rename
        // every track's distortion, delay, reverb, chorus and
        // bitcrusher came back at zero, silently, on a file the format
        // documentation promises will open and be upgraded.
        const file = legacyFile();
        file.data.trackFx = [{ distortion: 0.8, crushBits: 4 }, { reverbMix: 0.5 }];

        const { file: parsed } = parseProjectFile(file);

        expect(parsed.data.trackEffects).toEqual([
            { distortion: 0.8, crushBits: 4 },
            { reverbMix: 0.5 }
        ]);
        expect(parsed.data.trackFx).toBeUndefined();
    });

    it('prefers what this build wrote when a file carries both', () => {
        const file = legacyFile();
        file.data.trackFx = [{ distortion: 0.8 }];
        file.data.trackEffects = [{ distortion: 0.1 }];

        const { file: parsed } = parseProjectFile(file);

        expect(parsed.data.trackEffects).toEqual([{ distortion: 0.1 }]);
    });

    it('says nothing about effects a file does not carry', () => {
        const { file: parsed } = parseProjectFile(legacyFile());

        expect('trackEffects' in parsed.data).toBe(false);
    });

    it('folds the two instrument arrays into one record per track', () => {
        // The legacy app keeps the instrument on each track as two
        // parallel arrays read in step; this build keeps one array of
        // records, so a name cannot end up without its modified flag.
        const file = legacyFile();
        file.data.trackPresetNames = ['Classic Lead', 'Thin Lead', '\u2014', 'Sequencer'];
        file.data.trackCustomState = [false, true, false, false];

        const { file: parsed } = parseProjectFile(file);

        expect(parsed.data.trackPresets[0]).toEqual({
            id: null,
            source: 'custom',
            name: 'Classic Lead',
            // The legacy app never stored the sound a name refers to,
            // so there is nothing for Reset to go back to.
            sound: null,
            modified: false
        });
        // Saved already edited away from the preset it came from.
        expect(parsed.data.trackPresets[1]).toMatchObject({ name: 'Thin Lead', modified: true });
        // An em dash is how the legacy app writes "nothing".
        expect(parsed.data.trackPresets[2]).toBeNull();
        expect(parsed.data.trackPresets[4]).toBeNull();

        expect(parsed.data.trackPresetNames).toBeUndefined();
        expect(parsed.data.trackCustomState).toBeUndefined();
    });

    it('leaves a file that says nothing about its tracks saying nothing', () => {
        // Eight empty records would claim the project had been asked
        // and had answered.
        const { file: parsed } = parseProjectFile(legacyFile());

        expect('trackPresets' in parsed.data).toBe(false);
    });

    it('finds the arpeggio settings under the name the legacy app used', () => {
        // An arpeggio is part of an instrument, so a project that lost
        // it reopened with one track in eight playing something else.
        const file = legacyFile();
        file.data.arpSettings = [{ mode: 'up', rate: '1/16' }, { mode: 'off' }];

        const { file: parsed } = parseProjectFile(file);

        expect(parsed.data.arpeggiator).toEqual([{ mode: 'up', rate: '1/16' }, { mode: 'off' }]);
        expect(parsed.data.arpSettings).toBeUndefined();
    });

    it('prefers records this build wrote over the legacy arrays', () => {
        const file = legacyFile();
        file.data.trackPresetNames = ['Old Name'];
        file.data.trackPresets = [{ id: 'x', source: 'library', name: 'New Name' }];

        const { file: parsed } = parseProjectFile(file);

        expect(parsed.data.trackPresets[0].name).toBe('New Name');
        expect(parsed.data.trackPresetNames).toBeUndefined();
    });
});

describe('readProjectHeader', () => {
    it('reads a header without throwing on bad input', () => {
        const file = createProjectFile({ name: 'Header', data: state(), category: 'demo' });
        expect(readProjectHeader(file)).toMatchObject({ name: 'Header', category: 'demo' });
        expect(readProjectHeader('garbage')).toBeNull();
    });
});

describe('toFileName', () => {
    it('strips characters that are invalid in a file name', () => {
        expect(toFileName('My / Track: "2026"')).toBe('My Track 2026');
        expect(toFileName('   ')).toBe('Untitled');
        expect(toFileName(null)).toBe('Untitled');
    });
});
