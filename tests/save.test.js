import { describe, it, expect, beforeEach } from 'vitest';
import { saveOpenProject, canWriteFiles } from '../src/project/save.js';
import { ProjectSession } from '../src/project/project-session.js';
import { EventBus } from '../src/core/event-bus.js';
import { Library } from '../src/storage/library.js';
import { MemoryBackend } from '../src/storage/memory-backend.js';

/** A platform that keeps files in a map, like the one the session tests use. */
function fakePlatform({ overwriteInPlace = true } = {}) {
    return {
        id: 'test',
        capabilities: { overwriteInPlace, library: true, recentFiles: false },
        files: new Map(),
        asked: 0,
        cancelSaveAs: false,

        async saveProjectFileAs(defaultName, text) {
            this.asked += 1;
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

function setup({ overwriteInPlace = true } = {}) {
    const platform = fakePlatform({ overwriteInPlace });
    const bus = new EventBus();
    const library = new Library(new MemoryBackend(), { bus });
    const session = new ProjectSession({
        platform,
        bus,
        getState: () => ({ version: '1.2', sequencer: { bpm: 120 } }),
        setState: () => {}
    });
    const studio = { getProjectState: () => ({ version: '1.2', sequencer: { bpm: 120 } }) };
    return { platform, library, session, studio };
}

describe('saving the open project', () => {
    let context;

    beforeEach(() => {
        context = setup();
    });

    it('asks where to put a project that has never been saved, once', async () => {
        const { session, platform } = context;
        session.name = 'My Track';
        session.markDirty();

        const first = await saveOpenProject(context);
        expect(first).toMatchObject({ where: 'file', name: 'My Track' });
        expect(platform.asked).toBe(1);
        expect(platform.files.has('My Track.8bitforge')).toBe(true);

        // The second save writes the same file and asks nothing.
        session.markDirty();
        const second = await saveOpenProject(context);
        expect(second.where).toBe('file');
        expect(platform.asked).toBe(1);
        expect(session.isDirty).toBe(false);
    });

    it('leaves the library alone when it saves a file', async () => {
        const { session, library } = context;
        session.name = 'My Track';
        session.markDirty();

        await saveOpenProject(context);
        expect(await library.listProjects()).toEqual([]);
        expect(session.libraryId).toBeNull();
    });

    it('reports a cancelled save as cancelled, and keeps the changes', async () => {
        const { session, platform } = context;
        platform.cancelSaveAs = true;
        session.markDirty();

        expect(await saveOpenProject(context)).toEqual({ where: 'cancelled' });
        expect(session.isDirty).toBe(true);
    });

    it('saves into the library on a platform that cannot write files', async () => {
        const fallback = setup({ overwriteInPlace: false });
        fallback.session.name = 'No Files Here';
        fallback.session.markDirty();

        const result = await saveOpenProject(fallback);
        expect(result).toMatchObject({ where: 'library', name: 'No Files Here' });

        const projects = await fallback.library.listProjects();
        expect(projects.map((entry) => entry.name)).toEqual(['No Files Here']);
        // Saving again replaces that entry rather than leaving a second copy.
        fallback.session.markDirty();
        await saveOpenProject(fallback);
        expect(await fallback.library.listProjects()).toHaveLength(1);
        expect(fallback.platform.asked).toBe(0);
    });

    it('knows which platforms can write files', () => {
        expect(canWriteFiles(context.session)).toBe(true);
        expect(canWriteFiles(setup({ overwriteInPlace: false }).session)).toBe(false);
        expect(canWriteFiles({})).toBe(false);
    });
});
