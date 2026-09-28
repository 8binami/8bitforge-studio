import { describe, it, expect, beforeEach } from 'vitest';
import { ProjectSession } from '../src/project/project-session.js';
import { EventBus } from '../src/core/event-bus.js';
import { createProjectFile, serializeProjectFile } from '../src/project/format.js';

/**
 * In-memory platform double.
 * `overwriteInPlace: false` reproduces the browser download fallback.
 */
function fakePlatform({ overwriteInPlace = true } = {}) {
    return {
        id: 'test',
        capabilities: { overwriteInPlace, library: false, recentFiles: false },
        files: new Map(),
        nextOpen: null,
        cancelSaveAs: false,

        async openProjectFile() {
            return this.nextOpen;
        },

        async saveProjectFileAs(defaultName, text) {
            if (this.cancelSaveAs) return null;
            const name = `${defaultName}.8bitforge`;
            this.files.set(name, text);
            return { id: overwriteInPlace ? name : null, name };
        },

        async writeProjectFile(ref, text) {
            if (!ref?.id) return false;
            this.files.set(ref.id, text);
            return true;
        }
    };
}

function makeSession(platform, initialState = { version: '1.2', sequencer: { bpm: 120 } }) {
    let state = initialState;
    const bus = new EventBus();
    const session = new ProjectSession({
        platform,
        bus,
        getState: () => state,
        setState: (next) => {
            state = next;
        }
    });
    return { session, bus, readState: () => state };
}

describe('ProjectSession', () => {
    let platform;

    beforeEach(() => {
        platform = fakePlatform();
    });

    it('starts on an untitled, clean project', () => {
        const { session } = makeSession(platform);
        expect(session.name).toBe('Untitled');
        expect(session.fileRef).toBeNull();
        expect(session.isDirty).toBe(false);
        expect(session.canSaveInPlace).toBe(false);
    });

    it('saves as, then saves in place', async () => {
        const { session } = makeSession(platform);
        session.markDirty();

        const first = await session.saveAs('My Track');
        expect(first.saved).toBe(true);
        expect(session.isDirty).toBe(false);
        expect(session.canSaveInPlace).toBe(true);
        expect(platform.files.has('My Track.8bitforge')).toBe(true);

        session.markDirty();
        const second = await session.save();
        expect(second.saved).toBe(true);
        expect(second.path).toBe('My Track.8bitforge');
    });

    it('writes a file the format module can read back', async () => {
        const { session } = makeSession(platform, { version: '1.2', sequencer: { bpm: 140 } });
        await session.saveAs('Readable');

        const written = JSON.parse(platform.files.get('Readable.8bitforge'));
        expect(written.format).toBe('8bit-forge');
        expect(written.name).toBe('Readable');
        expect(written.data.sequencer.bpm).toBe(140);
    });

    it('falls back to save as when the file cannot be overwritten', async () => {
        platform = fakePlatform({ overwriteInPlace: false });
        const { session } = makeSession(platform);

        await session.saveAs('Download Only');
        expect(session.fileRef).toBeNull(); // no handle from a download
        expect(session.canSaveInPlace).toBe(false);

        const again = await session.save();
        expect(again.saved).toBe(true);
    });

    it('reports a cancelled save', async () => {
        const { session } = makeSession(platform);
        platform.cancelSaveAs = true;

        session.markDirty();
        const result = await session.saveAs('Nope');

        expect(result.saved).toBe(false);
        expect(session.isDirty).toBe(true);
    });

    it('opens a file and applies its state', async () => {
        const file = createProjectFile({
            name: 'Opened Track',
            data: { version: '1.2', sequencer: { bpm: 90 } },
            tags: ['demo']
        });
        platform.nextOpen = {
            ref: { id: 'Opened Track.8bitforge', name: 'Opened Track.8bitforge' },
            text: serializeProjectFile(file)
        };

        const { session, readState } = makeSession(platform);
        const result = await session.open();

        expect(result.opened).toBe(true);
        expect(result.migrated).toBe(false);
        expect(session.name).toBe('Opened Track');
        expect(session.tags).toEqual(['demo']);
        expect(readState().sequencer.bpm).toBe(90);
        expect(session.isDirty).toBe(false);
    });

    it('reports a legacy file as migrated', async () => {
        platform.nextOpen = {
            ref: { id: 'legacy.8bitforge', name: 'legacy.8bitforge' },
            text: JSON.stringify({
                format: '8bit-forge',
                version: '1.4.1',
                name: 'Legacy',
                exportedAt: '2026-03-03T14:30:25.000Z',
                data: { version: '1.1', tracks: [{ volume: 1 }] }
            })
        };

        const { session, readState } = makeSession(platform);
        const result = await session.open();

        expect(result).toMatchObject({ opened: true, migrated: true, fromVersion: '1.4.1' });
        expect(readState().tracks[0].volume).toBe(0.6);
    });

    it('adopts a project that came from the library', async () => {
        const file = createProjectFile({
            name: 'From Library',
            data: { version: '1.2', sequencer: { bpm: 95 } },
            tags: ['saved']
        });
        const { session, readState } = makeSession(platform);
        session.markDirty();

        session.adopt(file, { libraryId: 'from-library' });

        expect(session.name).toBe('From Library');
        expect(session.libraryId).toBe('from-library');
        expect(session.tags).toEqual(['saved']);
        expect(readState().sequencer.bpm).toBe(95);
        expect(session.isDirty).toBe(false);
        // No file behind it yet: saving has to ask where to put it
        expect(session.fileRef).toBeNull();
        expect(session.canSaveInPlace).toBe(false);
    });

    it('surfaces an unreadable file instead of throwing', async () => {
        platform.nextOpen = { ref: { id: 'bad', name: 'bad.8bitforge' }, text: 'nonsense' };
        const { session } = makeSession(platform);

        const result = await session.open();

        expect(result.opened).toBe(false);
        expect(result.error).toMatch(/valid JSON/);
        expect(session.name).toBe('Untitled'); // nothing was applied
    });

    it('emits dirty transitions once', () => {
        const { session, bus } = makeSession(platform);
        const seen = [];
        bus.on('project:dirty', (value) => seen.push(value));

        session.markDirty();
        session.markDirty();
        session.newProject('Fresh');

        expect(seen).toEqual([true, false]);
    });

    it('lets a loader clear the flag it raised while setting up', () => {
        const { session } = makeSession(platform);

        session.markDirty();
        session.markClean();

        expect(session.isDirty).toBe(false);
    });

    it('describes a project without touching its state', () => {
        const { session, bus, readState } = makeSession(platform);
        const before = readState();
        const described = [];
        bus.on('project:described', (event) => described.push(event));

        session.describe({
            name: '  Cavern Theme  ',
            category: 'platformer',
            tags: ['chiptune'],
            meta: { composer: 'Ada' },
            cover: 'data:image/jpeg;base64,AAAA'
        });

        expect(session.name).toBe('Cavern Theme');
        expect(session.category).toBe('platformer');
        expect(session.tags).toEqual(['chiptune']);
        expect(session.meta).toEqual({ composer: 'Ada' });
        expect(session.cover).toBe('data:image/jpeg;base64,AAAA');
        // The file on disk is now behind, so the project is unsaved.
        expect(session.isDirty).toBe(true);
        expect(described).toEqual([{ name: 'Cavern Theme' }]);
        expect(readState()).toBe(before);
    });

    it('leaves out of a description what it was not given', () => {
        const { session } = makeSession(platform);
        session.describe({ name: 'Kept', tags: ['one'] });

        session.describe({ category: 'rpg' });

        expect(session.name).toBe('Kept');
        expect(session.tags).toEqual(['one']);
        expect(session.category).toBe('rpg');
    });

    it('refuses to be renamed to nothing', () => {
        const { session } = makeSession(platform);
        session.describe({ name: 'Kept' });

        session.describe({ name: '   ' });

        expect(session.name).toBe('Kept');
    });

    it('forgets where the last project lived when a new one starts', () => {
        const { session } = makeSession(platform);
        session.libraryId = 'previous';

        session.newProject('Fresh');

        // Otherwise the first save of this project writes over the last one.
        expect(session.libraryId).toBeNull();
    });

    it('forgets the library entry when a file is opened', async () => {
        const file = createProjectFile({ name: 'From Disk', data: { version: '1.2' } });
        platform.nextOpen = {
            ref: { id: 'disk.8bitforge', name: 'disk.8bitforge' },
            text: serializeProjectFile(file)
        };
        const { session } = makeSession(platform);
        session.libraryId = 'previous';

        await session.open();

        expect(session.libraryId).toBeNull();
    });
});
