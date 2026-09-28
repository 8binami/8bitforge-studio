import { describe, it, expect, beforeEach } from 'vitest';
import {
    Library,
    LIBRARY_KINDS,
    LIBRARY_EVENTS,
    LibraryFormatError
} from '../src/storage/library.js';
import { MemoryBackend } from '../src/storage/memory-backend.js';
import { EventBus } from '../src/core/event-bus.js';
import { ProjectFormatError } from '../src/project/format.js';

function makeLibrary() {
    const backend = new MemoryBackend();
    const bus = new EventBus();
    const changes = [];
    bus.on(LIBRARY_EVENTS.changed, (event) => changes.push(event));

    return { backend, bus, changes, library: new Library(backend, { bus }) };
}

const STATE = () => ({ version: '1.2', sequencer: { bpm: 120 } });

describe('Library projects', () => {
    let library;
    let backend;

    beforeEach(() => {
        ({ library, backend } = makeLibrary());
    });

    it('starts empty', async () => {
        expect(await library.listProjects()).toEqual([]);
    });

    it('writes a project and reads it back', async () => {
        const { id } = await library.writeProject({ name: 'My Track', data: STATE() });

        const listed = await library.listProjects();
        expect(listed).toHaveLength(1);
        expect(listed[0]).toMatchObject({ id, name: 'My Track' });

        const { file } = await library.readProject(id);
        expect(file.name).toBe('My Track');
        expect(file.data.sequencer.bpm).toBe(120);
    });

    it('stores a readable project file, not a private blob', async () => {
        const { id } = await library.writeProject({ name: 'Readable', data: STATE() });
        const raw = JSON.parse(await backend.read(LIBRARY_KINDS.projects, id));

        expect(raw.format).toBe('8bit-forge');
        expect(raw.version).toBe('2.0');
    });

    it('names the file after the project, safely', async () => {
        const { id } = await library.writeProject({ name: 'A/B: "C"', data: STATE() });
        expect(id).toBe('AB C');
    });

    it('returns nothing for a project that is not there', async () => {
        expect(await library.readProject('ghost')).toBeNull();
    });

    it('keeps the creation date when saving over a project', async () => {
        const first = await library.writeProject({ name: 'Track', data: STATE() });
        const createdAt = first.file.createdAt;

        await new Promise((resolve) => setTimeout(resolve, 5));
        const second = await library.writeProject({
            id: first.id,
            name: 'Track',
            data: { ...STATE(), sequencer: { bpm: 140 } }
        });

        expect(second.file.createdAt).toBe(createdAt);
        expect(second.file.updatedAt).not.toBe(createdAt);
    });

    it('migrates a project written by the old app', async () => {
        await backend.write(
            LIBRARY_KINDS.projects,
            'legacy',
            JSON.stringify({
                format: '8bit-forge',
                version: '1.4.1',
                name: 'Legacy',
                exportedAt: '2026-03-03T14:30:25.000Z',
                data: { version: '1.1', tracks: [{ volume: 1 }] }
            })
        );

        const { file, migrated } = await library.readProject('legacy');

        expect(migrated).toBe(true);
        expect(file.version).toBe('2.0');
        expect(file.data.tracks[0].volume).toBe(0.6);
    });

    it('says plainly when a file is not a project', async () => {
        await backend.write(LIBRARY_KINDS.projects, 'junk', 'not json at all');
        await expect(library.readProject('junk')).rejects.toThrow(ProjectFormatError);
    });

    it('removes a project', async () => {
        const { id } = await library.writeProject({ name: 'Doomed', data: STATE() });

        expect(await library.removeProject(id)).toBe(true);
        expect(await library.listProjects()).toEqual([]);
        expect(await library.removeProject(id)).toBe(false);
    });
});

describe('Library naming', () => {
    let library;

    beforeEach(() => {
        ({ library } = makeLibrary());
    });

    it('gives a new project a free id rather than one already in use', async () => {
        const first = await library.writeProject({ name: 'Cavern Theme', data: STATE() });
        const second = await library.writeProject({ name: 'Cavern Theme', data: STATE() });
        const third = await library.writeProject({ name: 'Cavern Theme', data: STATE() });

        expect([first.id, second.id, third.id]).toEqual([
            'Cavern Theme',
            'Cavern Theme 2',
            'Cavern Theme 3'
        ]);
        // Three projects called the same thing are still three projects.
        expect(await library.listProjects()).toHaveLength(3);
    });

    it('saves over the same project without renaming it', async () => {
        const { id } = await library.writeProject({ name: 'Cavern Theme', data: STATE() });

        const again = await library.writeProject({ id, name: 'Cavern Theme', data: STATE() });

        expect(again.id).toBe(id);
        expect(await library.listProjects()).toHaveLength(1);
    });

    it('moves a project when it is renamed, leaving no orphan behind', async () => {
        const { id } = await library.writeProject({ name: 'Cavern Theme', data: STATE() });

        const moved = await library.writeProject({ id, name: 'Boss Fight', data: STATE() });

        expect(moved.id).toBe('Boss Fight');
        expect((await library.listProjects()).map((entry) => entry.id)).toEqual(['Boss Fight']);
    });

    it('will not rename a project on top of another one', async () => {
        await library.writeProject({ name: 'Boss Fight', data: STATE() });
        const { id } = await library.writeProject({ name: 'Cavern Theme', data: STATE() });

        const moved = await library.writeProject({ id, name: 'Boss Fight', data: STATE() });

        expect(moved.id).toBe('Boss Fight 2');
        expect((await library.listProjects()).map((entry) => entry.id).sort()).toEqual([
            'Boss Fight',
            'Boss Fight 2'
        ]);
    });

    it('applies the same rules to kits and presets', async () => {
        const first = await library.write(LIBRARY_KINDS.kits, { name: 'Drums', data: {} });
        const second = await library.write(LIBRARY_KINDS.kits, { name: 'Drums', data: {} });
        const moved = await library.write(LIBRARY_KINDS.kits, {
            id: second.id,
            name: 'Percussion',
            data: {}
        });

        expect([first.id, second.id, moved.id]).toEqual(['Drums', 'Drums 2', 'Percussion']);
        expect((await library.list(LIBRARY_KINDS.kits)).map((entry) => entry.id).sort()).toEqual([
            'Drums',
            'Percussion'
        ]);
    });

    it('keeps the creation date across a rename', async () => {
        const { id, file } = await library.writeProject({ name: 'Cavern Theme', data: STATE() });

        const moved = await library.writeProject({ id, name: 'Boss Fight', data: STATE() });

        expect(moved.file.createdAt).toBe(file.createdAt);
    });
});

describe('Library items', () => {
    let library;

    beforeEach(() => {
        ({ library } = makeLibrary());
    });

    it('stores kits, presets and generator presets apart', async () => {
        await library.write(LIBRARY_KINDS.kits, { name: 'My Kit', data: { tracks: [] } });
        await library.write(LIBRARY_KINDS.presets, { name: 'My Lead', data: { type: 'square' } });
        await library.write(LIBRARY_KINDS.generatorPresets, { name: 'My Genre', data: {} });

        expect(await library.list(LIBRARY_KINDS.kits)).toHaveLength(1);
        expect(await library.list(LIBRARY_KINDS.presets)).toHaveLength(1);
        expect(await library.list(LIBRARY_KINDS.generatorPresets)).toHaveLength(1);
    });

    it('round-trips an item with its tags', async () => {
        const { id } = await library.write(LIBRARY_KINDS.presets, {
            name: 'Fat Bass',
            data: { type: 'triangle', volume: 0.3 },
            tags: ['bass', 'warm']
        });

        const item = await library.read(LIBRARY_KINDS.presets, id);

        expect(item).toMatchObject({ name: 'Fat Bass', tags: ['bass', 'warm'] });
        expect(item.data.type).toBe('triangle');
        expect(item.createdAt).toBeTruthy();
    });

    it('keeps the creation date when saving over an item', async () => {
        const { id } = await library.write(LIBRARY_KINDS.kits, { name: 'Kit', data: {} });
        const first = await library.read(LIBRARY_KINDS.kits, id);

        await new Promise((resolve) => setTimeout(resolve, 5));
        await library.write(LIBRARY_KINDS.kits, { id, name: 'Kit', data: { changed: true } });
        const second = await library.read(LIBRARY_KINDS.kits, id);

        expect(second.createdAt).toBe(first.createdAt);
        expect(second.updatedAt).not.toBe(first.updatedAt);
        expect(second.data.changed).toBe(true);
    });

    it('needs a name', async () => {
        await expect(library.write(LIBRARY_KINDS.kits, { data: {} })).rejects.toThrow(TypeError);
    });

    it('refuses a kind it does not know', async () => {
        await expect(library.list('songs')).rejects.toThrow(TypeError);
        await expect(library.read('songs', 'x')).rejects.toThrow(TypeError);
    });

    it('says plainly when a stored item is not one', async () => {
        const { backend, library: lib } = makeLibrary();
        await backend.write(LIBRARY_KINDS.kits, 'odd', JSON.stringify({ hello: 'world' }));

        await expect(lib.read(LIBRARY_KINDS.kits, 'odd')).rejects.toThrow(LibraryFormatError);
    });

    it('returns nothing for an item that is not there', async () => {
        expect(await library.read(LIBRARY_KINDS.presets, 'ghost')).toBeNull();
    });

    it('removes an item', async () => {
        const { id } = await library.write(LIBRARY_KINDS.presets, { name: 'Gone', data: {} });

        expect(await library.remove(LIBRARY_KINDS.presets, id)).toBe(true);
        expect(await library.list(LIBRARY_KINDS.presets)).toEqual([]);
    });
});

describe('Library searching', () => {
    let library;

    beforeEach(async () => {
        ({ library } = makeLibrary());
        await library.write(LIBRARY_KINDS.presets, {
            name: 'Fat Bass',
            data: {},
            tags: ['bass', 'warm']
        });
        await library.write(LIBRARY_KINDS.presets, {
            name: 'Bright Lead',
            data: {},
            tags: ['lead']
        });
        await library.write(LIBRARY_KINDS.presets, { name: 'Sub Bass', data: {}, tags: ['bass'] });
    });

    it('searches by name', async () => {
        const found = await library.search(LIBRARY_KINDS.presets, { query: 'bass' });
        expect(found.map((item) => item.name)).toEqual(['Fat Bass', 'Sub Bass']);
    });

    it('searches by tag', async () => {
        const found = await library.search(LIBRARY_KINDS.presets, { tags: ['warm'] });
        expect(found.map((item) => item.name)).toEqual(['Fat Bass']);
    });

    it('reports the tags in use', async () => {
        expect(await library.tagsInUse(LIBRARY_KINDS.presets)).toEqual([
            { tag: 'bass', count: 2 },
            { tag: 'lead', count: 1 },
            { tag: 'warm', count: 1 }
        ]);
    });

    it('refuses a kind it does not know', async () => {
        await expect(library.search('songs')).rejects.toThrow(TypeError);
        await expect(library.tagsInUse('songs')).rejects.toThrow(TypeError);
    });
});

describe('Library import and export', () => {
    let library;

    beforeEach(() => {
        ({ library } = makeLibrary());
    });

    it('takes in a project file', async () => {
        const file = JSON.stringify({
            format: '8bit-forge',
            version: '2.0',
            name: 'Shared Track',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            category: 'custom',
            tags: ['from-a-friend'],
            meta: {},
            cover: null,
            data: STATE()
        });

        const result = await library.importProject(file);

        expect(result).toMatchObject({ name: 'Shared Track', migrated: false });
        const { file: stored } = await library.readProject(result.id);
        expect(stored.tags).toEqual(['from-a-friend']);
        expect(stored.createdAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('migrates a project written by the old app on the way in', async () => {
        const legacy = JSON.stringify({
            format: '8bit-forge',
            version: '1.4.1',
            name: 'Old Track',
            exportedAt: '2026-03-03T14:30:25.000Z',
            data: { version: '1.1', tracks: [{ volume: 1 }] }
        });

        const result = await library.importProject(legacy);

        expect(result.migrated).toBe(true);
        const { file } = await library.readProject(result.id);
        expect(file.data.tracks[0].volume).toBe(0.6);
    });

    it('can be told what to call an imported project', async () => {
        const file = JSON.stringify({
            format: '8bit-forge',
            version: '2.0',
            name: 'Shared Track',
            data: STATE()
        });

        const result = await library.importProject(file, { name: 'My Copy' });

        expect(result.name).toBe('My Copy');
    });

    it('refuses a file that is not a project', async () => {
        await expect(library.importProject('nonsense')).rejects.toThrow(ProjectFormatError);
    });

    it('takes in an exported item', async () => {
        const { id } = await library.write(LIBRARY_KINDS.kits, {
            name: 'My Kit',
            data: { tracks: [1, 2] },
            tags: ['custom']
        });
        const exported = await library.exportItem(LIBRARY_KINDS.kits, id);

        const fresh = makeLibrary();
        const imported = await fresh.library.importItem(LIBRARY_KINDS.kits, exported.contents);

        const item = await fresh.library.read(LIBRARY_KINDS.kits, imported.id);
        expect(item.name).toBe('My Kit');
        expect(item.tags).toEqual(['custom']);
        expect(item.data.tracks).toEqual([1, 2]);
    });

    it('refuses a file that is not a library item', async () => {
        await expect(library.importItem(LIBRARY_KINDS.kits, 'nonsense')).rejects.toThrow(
            LibraryFormatError
        );
        await expect(
            library.importItem(LIBRARY_KINDS.kits, JSON.stringify({ hello: 'world' }))
        ).rejects.toThrow(LibraryFormatError);
    });

    it('hands out a project under its own extension', async () => {
        const { id } = await library.writeProject({ name: 'My Track', data: STATE() });

        const exported = await library.exportItem(LIBRARY_KINDS.projects, id);

        expect(exported.name).toBe('My Track.8bitforge');
        expect(JSON.parse(exported.contents).format).toBe('8bit-forge');
    });

    it('returns nothing when there is nothing to export', async () => {
        expect(await library.exportItem(LIBRARY_KINDS.kits, 'ghost')).toBeNull();
    });
});

describe('Library events', () => {
    it('announces what changed, so a view can refresh that list alone', async () => {
        const { library, changes } = makeLibrary();

        await library.writeProject({ name: 'Track', data: STATE() });
        await library.write(LIBRARY_KINDS.kits, { name: 'Kit', data: {} });

        expect(changes).toEqual([{ kind: 'projects' }, { kind: 'kits' }]);
    });

    it('stays quiet when a removal changed nothing', async () => {
        const { library, changes } = makeLibrary();

        await library.removeProject('ghost');

        expect(changes).toEqual([]);
    });
});

describe('MemoryBackend', () => {
    it('admits it does not persist', () => {
        expect(new MemoryBackend().isPersistent).toBe(false);
    });

    it('lists items by name, in order', async () => {
        const { library, backend } = makeLibrary();
        await library.write(LIBRARY_KINDS.kits, { name: 'Zebra', data: {} });
        await library.write(LIBRARY_KINDS.kits, { name: 'Apple', data: {} });

        const listed = await backend.list(LIBRARY_KINDS.kits);
        expect(listed.map((item) => item.name)).toEqual(['Apple', 'Zebra']);
    });

    it('falls back to the id when a file has no readable name', async () => {
        const backend = new MemoryBackend();
        await backend.write(LIBRARY_KINDS.kits, 'odd-file', 'not json');

        expect((await backend.list(LIBRARY_KINDS.kits))[0].name).toBe('odd-file');
    });

    it('clears everything', async () => {
        const { library, backend } = makeLibrary();
        await library.writeProject({ name: 'Track', data: STATE() });

        backend.clear();

        expect(await library.listProjects()).toEqual([]);
    });
});
