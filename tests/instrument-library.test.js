import { describe, it, expect, beforeEach } from 'vitest';
import { AudioEngine } from '../src/audio/audio-engine.js';
import { Synthesizer } from '../src/audio/synthesizer.js';
import { TrackEffects } from '../src/audio/track-effects.js';
import { Arpeggiator } from '../src/compose/arpeggiator.js';
import { InstrumentLibrary } from '../src/compose/instrument-library.js';
import { EventBus } from '../src/core/event-bus.js';
import { FakeAudioContext } from './helpers/fake-audio-context.js';

async function makeLibrary({ withFx = false } = {}) {
    const context = new FakeAudioContext();
    const engine = new AudioEngine({ createContext: () => context });
    await engine.init();

    if (withFx) {
        const fx = new TrackEffects(engine);
        await fx.ready;
        engine.trackEffects = fx;
    }

    const bus = new EventBus();
    const synth = new Synthesizer(engine, { bus });
    const arpeggiator = new Arpeggiator(engine);
    const library = new InstrumentLibrary(engine, synth, { arpeggiator });

    return { engine, bus, synth, arpeggiator, library };
}

/** A preset key that exists, without pinning the test to one name. */
function anyPresetKey(library) {
    return Object.keys(library.presets)[0];
}

describe('InstrumentLibrary catalogue', () => {
    let library;

    beforeEach(async () => {
        ({ library } = await makeLibrary());
    });

    it('ships a sizeable preset collection', () => {
        expect(Object.keys(library.presets).length).toBeGreaterThan(20);
    });

    it('groups presets into categories, with no key left out', () => {
        const categories = library.getPresetsByCategory();
        const grouped = Object.values(categories).flat();

        expect(Object.keys(categories).length).toBeGreaterThan(1);
        // Every preset must be reachable: categories are matched on the key
        // prefix, and an unmatched prefix used to drop the preset silently.
        expect(grouped.sort()).toEqual(Object.keys(library.presets).sort());
    });

    it('files the piano presets under acoustic', () => {
        expect(library.getPresetsByCategory().acoustic).toContain('piano-lead');
    });

    it('lists presets in the shape the library view expects', () => {
        const list = library.getBuiltinPresetList();

        expect(list.length).toBeGreaterThan(0);
        expect(list[0]).toMatchObject({ source: 'builtin', isPublic: false });
        expect(list[0].data).toHaveProperty('type');
    });

    it('ships kits of eight tracks', () => {
        const kits = library.getBuiltinKits();
        const [firstKit] = Object.values(kits);

        expect(Object.keys(kits).length).toBeGreaterThan(0);
        expect(firstKit.tracks).toHaveLength(8);
    });

    it('lists kits with their cover and category', () => {
        const list = library.getBuiltinKitList();

        expect(list[0]).toMatchObject({ source: 'builtin' });
        expect(list[0].name).toBeTruthy();
        expect(list[0].data.tracks).toHaveLength(8);
    });
});

describe('InstrumentLibrary loading a preset', () => {
    let engine;
    let synth;
    let library;

    beforeEach(async () => {
        ({ engine, synth, library } = await makeLibrary());
    });

    it('writes the preset onto the target track', () => {
        const key = anyPresetKey(library);

        expect(library.loadPreset(key, 3)).toBe(true);

        const preset = library.presets[key];
        expect(engine.tracks[3].type).toBe(preset.type);
        expect(library.getTrackPresetName(3)).toBe(preset.name || key);
    });

    it('loads onto the selected track when none is given', () => {
        synth.setCurrentTrack(5);
        library.loadPreset(anyPresetKey(library));

        expect(library.getTrackPresetName(5)).toBeTruthy();
        expect(library.getTrackPresetName(0)).toBeNull();
    });

    it('reports an unknown preset', () => {
        expect(library.loadPreset('not-a-preset', 0)).toBe(false);
    });

    it('leaves nothing behind from the previous instrument', () => {
        engine.tracks[0].filterEnabled = true;
        engine.tracks[0].filterCutoff = 300;
        engine.tracks[0].unisonVoices = 5;

        const clean = Object.entries(library.presets).find(
            ([, preset]) => !preset.filterEnabled && !preset.unisonVoices
        );
        library.loadPreset(clean[0], 0);

        expect(engine.tracks[0].filterCutoff).toBe(20000);
        expect(engine.tracks[0].unisonVoices).toBe(1);
    });

    it('applies the preset FX when an FX chain is attached', async () => {
        const fxLibrary = await makeLibrary({ withFx: true });
        const withFx = Object.entries(fxLibrary.library.presets).find(
            ([, preset]) => preset.fx?.distortion
        );
        if (!withFx) return;

        fxLibrary.library.loadPreset(withFx[0], 1);

        // The amount the preset asked for, not the wet/dry switch beside
        // it: those read the same only when the preset is at full tilt.
        expect(fxLibrary.engine.trackEffects.getTrackParams(1).distortion).toBeCloseTo(
            withFx[1].fx.distortion,
            4
        );
    });

    it('works with no FX chain attached', () => {
        expect(engine.trackEffects).toBeNull();
        expect(() => library.loadPreset(anyPresetKey(library), 0)).not.toThrow();
    });

    it('recalls the arpeggiator settings a preset carries', async () => {
        const { library: lib, arpeggiator } = await makeLibrary();
        const withArp = Object.entries(lib.presets).find(([, preset]) => preset.arp?.mode);
        if (!withArp) return;

        lib.loadPreset(withArp[0], 2);

        expect(arpeggiator.getSettings(2).mode).toBe(withArp[1].arp.mode);
    });

    it('silences the arpeggiator when resetting a track', async () => {
        const { library: lib, arpeggiator } = await makeLibrary();
        arpeggiator.updateSettings(4, { mode: 'up' });

        lib.resetTrackToDefaults(4);

        expect(arpeggiator.getSettings(4).mode).toBe('off');
    });

    it('announces the change for the synth panel', async () => {
        const { library: lib, bus } = await makeLibrary();
        const events = [];
        bus.on('synth:changed', (track) => events.push(track));

        lib.loadPreset(anyPresetKey(lib), 0);

        expect(events).toContain(0);
    });
});

describe('InstrumentLibrary preset data', () => {
    it('loads an instrument from raw preset data', async () => {
        const { synth, library } = await makeLibrary();
        synth.setWaveform('sawtooth');
        synth.setDetune('30');
        const saved = synth.getFullPresetState(0);

        expect(library.loadPresetData(saved, 6, 'My Lead')).toBe(true);

        expect(library.getTrackPresetName(6)).toBe('My Lead');
        expect(synth.getFullPresetState(6).detune).toBe(30);
    });

    it('accepts preset data as JSON text', async () => {
        const { synth, library } = await makeLibrary();
        const saved = JSON.stringify(synth.getFullPresetState(0));

        expect(library.loadPresetData(saved, 1)).toBe(true);
    });

    it('reports nothing to load', async () => {
        const { library } = await makeLibrary();
        expect(library.loadPresetData(null, 0)).toBe(false);
    });
});

describe('InstrumentLibrary kits', () => {
    it('applies a kit across the eight tracks', async () => {
        const { engine, library } = await makeLibrary();
        const kit = Object.values(library.getBuiltinKits())[0];

        library.applyKit({ tracks: kit.tracks });

        for (let track = 0; track < 8; track++) {
            if (kit.tracks[track]?.presetKey) {
                expect(library.getTrackPresetName(track)).toBeTruthy();
            }
        }
        expect(engine.tracks).toHaveLength(8);
    });

    it('ignores a malformed kit', async () => {
        const { library } = await makeLibrary();
        expect(() => library.applyKit(null)).not.toThrow();
        expect(() => library.applyKit({ tracks: 'nope' })).not.toThrow();
    });

    it('captures the current tracks as a kit', async () => {
        const { synth, library } = await makeLibrary();
        synth.setCurrentTrack(0);
        synth.setWaveform('triangle');

        const state = library.getCurrentKitState();

        expect(state.tracks).toHaveLength(8);
        expect(state.tracks[0]).toMatchObject({ presetType: 'custom', presetKey: null });
        expect(state.tracks[0].presetData.type).toBe('triangle');
    });

    it('round-trips a captured kit', async () => {
        const { synth, library } = await makeLibrary();
        synth.setCurrentTrack(2);
        synth.setWaveform('sawtooth');
        synth.setDetune('20');
        const captured = library.getCurrentKitState();

        const fresh = await makeLibrary();
        fresh.library.applyKit(captured);

        expect(fresh.synth.getFullPresetState(2).type).toBe('sawtooth');
        expect(fresh.synth.getFullPresetState(2).detune).toBe(20);
    });
});

describe('what is on a track', () => {
    let engine;
    let synth;
    let library;

    beforeEach(async () => {
        ({ engine, synth, library } = await makeLibrary());
    });

    it('knows nothing about a track nothing was loaded onto', () => {
        expect(library.getTrackPreset(0)).toBeNull();
        // Not "unmodified" but "nothing to compare with": a track built by
        // hand has no preset behind it to be put back to.
        expect(library.isTrackModified(0)).toBe(false);
    });

    it('records where a built-in instrument came from', () => {
        const key = anyPresetKey(library);
        library.loadPreset(key, 2);

        expect(library.getTrackPreset(2)).toEqual({
            id: key,
            source: 'builtin',
            name: library.presets[key].name
        });
        expect(library.isTrackModified(2)).toBe(false);
    });

    it('records where a saved instrument came from', () => {
        library.loadPresetData({ type: 'triangle', volume: 0.2 }, 4, 'My Bell', {
            id: 'my-bell',
            source: 'library'
        });

        expect(library.getTrackPreset(4)).toEqual({
            id: 'my-bell',
            source: 'library',
            name: 'My Bell'
        });
    });

    it('notices the track being altered, and notices it being put back', () => {
        library.loadPreset(anyPresetKey(library), 1);
        const before = engine.tracks[1].detune;

        engine.tracks[1].detune = before + 25;
        expect(library.isTrackModified(1)).toBe(true);

        // A flag would still say modified here. Comparing the sound with
        // the sound it started as cannot: it is the same sound again.
        engine.tracks[1].detune = before;
        expect(library.isTrackModified(1)).toBe(false);
    });

    it('answers for one track without answering for another', () => {
        library.loadPreset(anyPresetKey(library), 0);
        library.loadPreset(anyPresetKey(library), 1);

        engine.tracks[0].volume = 0.4;

        expect(library.isTrackModified(0)).toBe(true);
        expect(library.isTrackModified(1)).toBe(false);
    });

    it('forgets every track at once', () => {
        library.loadPreset(anyPresetKey(library), 0);
        library.loadPreset(anyPresetKey(library), 7);

        library.forgetTrackPresets();

        expect(library.getTrackPreset(0)).toBeNull();
        expect(library.getTrackPreset(7)).toBeNull();
        expect(library.getTrackPresetName(0)).toBeNull();
    });

    it('records all eight slots of a kit', () => {
        const kit = Object.values(library.getBuiltinKits())[0];
        library.applyKit(kit);

        for (let track = 0; track < 8; track++) {
            expect(library.getTrackPreset(track)?.source).toBe('builtin');
            expect(library.isTrackModified(track)).toBe(false);
        }
        expect(synth.currentTrack).toBe(0);
    });
});

describe('putting a track back', () => {
    let engine;
    let library;

    beforeEach(async () => {
        ({ engine, library } = await makeLibrary());
    });

    it('offers nothing on a track nobody has touched', () => {
        library.loadPreset(anyPresetKey(library), 1);

        // A Reset on an unaltered track restores it to itself.
        expect(library.canRevertTrack(1)).toBe(false);
        expect(library.canRevertTrack(5)).toBe(false);
    });

    it('restores a shipped instrument', () => {
        library.loadPreset(anyPresetKey(library), 1);
        const detune = engine.tracks[1].detune;

        engine.tracks[1].detune = detune + 40;
        expect(library.canRevertTrack(1)).toBe(true);

        expect(library.revertTrack(1)).toBe(true);
        expect(engine.tracks[1].detune).toBe(detune);
        expect(library.isTrackModified(1)).toBe(false);
    });

    it('restores a sound that belongs to no library', () => {
        // A kit slot, or a voice that came in with a project. This is
        // the case Reset used to be shown for and do nothing about:
        // with no entry to read back from, the button returned early.
        library.loadPresetData({ type: 'triangle', volume: 0.2, detune: 7 }, 3, 'From a kit', {
            source: 'custom'
        });

        engine.tracks[3].detune = 99;
        engine.tracks[3].type = 'sawtooth';

        expect(library.canRevertTrack(3)).toBe(true);
        expect(library.revertTrack(3)).toBe(true);
        expect(engine.tracks[3]).toMatchObject({ type: 'triangle', detune: 7 });
    });

    it('restores the sound that was loaded, not what the library holds now', () => {
        // Reset means "back to how this track was". Reading the entry
        // again answers a different question, and a different one again
        // the moment somebody saves over it.
        library.loadPresetData({ type: 'sine', detune: 5 }, 0, 'My Bell', {
            id: 'my-bell',
            source: 'library'
        });
        engine.tracks[0].detune = 60;

        library.revertTrack(0);

        expect(engine.tracks[0].detune).toBe(5);
    });

    it('restores the whole voice, not the oscillator alone', () => {
        library.loadPresetData(
            {
                type: 'square',
                envelope: { attack: 0.2, decay: 0.3, sustain: 0.4, release: 0.5 },
                vibrato: { rate: 6, depth: 12 }
            },
            2,
            'Wobble'
        );

        engine.envelopes[2].attack = 0.001;
        engine.vibrato[2].depth = 0;
        library.revertTrack(2);

        expect(engine.envelopes[2]).toMatchObject({ attack: 0.2, release: 0.5 });
        expect(engine.vibrato[2]).toMatchObject({ rate: 6, depth: 12 });
    });

    it('refuses a track it knows nothing about', () => {
        expect(library.revertTrack(6)).toBe(false);
    });

    it('keeps its snapshot when the track moves on', () => {
        library.loadPreset(anyPresetKey(library), 0);
        const snapshot = library._trackPresets[0].sound;

        engine.tracks[0].detune = 300;
        engine.tracks[0].volume = 0.9;

        // A record that followed the engine would turn Reset into a
        // no-op, and nothing anywhere would say so.
        expect(snapshot.detune).not.toBe(300);
        expect(snapshot.volume).not.toBe(0.9);
    });
});

describe('what a project says about its tracks', () => {
    let engine;
    let library;

    beforeEach(async () => {
        ({ engine, library } = await makeLibrary());
    });

    it('writes nothing for tracks nothing was loaded onto', () => {
        expect(library.captureTrackPresets()).toEqual(Array(8).fill(null));
    });

    it('writes where each instrument came from and the sound it arrived as', () => {
        const key = anyPresetKey(library);
        library.loadPreset(key, 0);
        const arrived = engine.tracks[0].detune;
        engine.tracks[0].detune = arrived + 44;

        const written = library.captureTrackPresets();

        expect(written[0]).toMatchObject({
            id: key,
            source: 'builtin',
            name: library.presets[key].name
        });
        // The sound as it arrived, not the sound on the track now: the
        // second is already in the file, as the tracks themselves.
        expect(written[0].sound.detune).toBe(arrived);
        expect(written[1]).toBeNull();
    });

    it('does not write a modified flag it can work out', () => {
        // Two ways of saying one thing is how the legacy app ended up
        // with two arrays that could disagree.
        library.loadPreset(anyPresetKey(library), 0);

        expect('modified' in library.captureTrackPresets()[0]).toBe(false);
    });

    it('comes back exactly as it was handed out', () => {
        const key = anyPresetKey(library);
        library.loadPreset(key, 4);
        const arrived = engine.tracks[4].detune;
        engine.tracks[4].detune = arrived + 30;

        const written = structuredClone(library.captureTrackPresets());

        // A different project in between, as a load or an undo would be.
        library.loadPreset(anyPresetKey(library), 4);
        engine.tracks[4].detune = arrived + 30;
        library.rememberTrackPresets(written);

        expect(library.getTrackPresetName(4)).toBe(library.presets[key].name);
        expect(library.isTrackModified(4)).toBe(true);
        expect(library.canRevertTrack(4)).toBe(true);

        library.revertTrack(4);
        expect(engine.tracks[4].detune).toBe(arrived);
    });

    it('does not make an edit its own baseline', () => {
        // The state a record travels in also carries the sound on the
        // track, which is the edited one whenever it has been edited.
        // Reading the engine instead of the record would turn every
        // undo through a modified track into a permanent edit.
        const key = anyPresetKey(library);
        library.loadPreset(key, 2);
        const clean = engine.tracks[2].detune;
        engine.tracks[2].detune = clean + 50;

        const captured = structuredClone(library.captureTrackPresets());
        library.rememberTrackPresets(captured);

        expect(library.canRevertTrack(2)).toBe(true);
        library.revertTrack(2);
        expect(engine.tracks[2].detune).toBe(clean);
        expect(library.isTrackModified(2)).toBe(false);
    });

    it('keeps a record that never had a name', () => {
        // A kit slot with no display name. It has a sound to go back
        // to like any other, and dropping it on the way back in would
        // take Reset away from it at the first undo.
        library.loadPresetData({ type: 'triangle', detune: 7 }, 2, null, { source: 'custom' });

        const written = structuredClone(library.captureTrackPresets());
        library.rememberTrackPresets(written);

        engine.tracks[2].detune = 80;
        expect(library.canRevertTrack(2)).toBe(true);
        library.revertTrack(2);
        expect(engine.tracks[2].detune).toBe(7);
    });

    it('says a sound that arrived already edited is edited, with nowhere to go', () => {
        // What a legacy file gives: a name and a flag, and never the
        // sound the name refers to. Calling it unmodified would claim
        // the track is that preset; offering Reset would offer to
        // restore what is already there.
        library.rememberTrackPresets([
            { id: null, source: 'custom', name: 'Slap Bass', sound: null, modified: true },
            ...Array(7).fill(null)
        ]);

        expect(library.getTrackPresetName(0)).toBe('Slap Bass');
        expect(library.isTrackModified(0)).toBe(true);
        expect(library.canRevertTrack(0)).toBe(false);
        expect(library.revertTrack(0)).toBe(false);
    });

    it('forgets the last project before taking up the new one', () => {
        library.loadPreset(anyPresetKey(library), 7);

        library.rememberTrackPresets([]);

        expect(library.getTrackPreset(7)).toBeNull();
    });

    it('survives a project that says nothing about its tracks', () => {
        library.loadPreset(anyPresetKey(library), 7);

        library.rememberTrackPresets(null);

        expect(library.getTrackPreset(7)).toBeNull();
    });
});

describe('a sound remembered before the audio existed', () => {
    /**
     * The order a session actually happens in: a project is opened, and
     * only then is something played. Until the first press of Play there
     * is no per-track effects chain, so a sound read off the engine has
     * no effects in it: and the moment the chain arrives, a snapshot
     * taken without one stops matching the track it was taken from.
     * Every named track would read as edited, having been untouched.
     */
    it('does not turn a track orange when the chain turns up', async () => {
        const { engine, library } = await makeLibrary({ withFx: true });
        const effects = engine.trackEffects;

        // As a studio is before the first press of Play.
        engine.trackEffects = null;
        library.loadPreset(anyPresetKey(library), 3);
        expect(library._trackPresets[3].sound.fx).toBeNull();
        expect(library.isTrackModified(3)).toBe(false);

        // Play. The comparison stands aside for a difference neither
        // side could see, so the track is still what it was.
        engine.trackEffects = effects;
        library.adoptTrackEffects();

        expect(library.isTrackModified(3)).toBe(false);
        expect(library.canRevertTrack(3)).toBe(false);
    });

    it('starts noticing the effects once there is a chain to notice them on', async () => {
        // The reason the snapshot has to take them in rather than just
        // be excused: with no effects in it, every later change to them
        // would go on being excused and Reset would never offer to put
        // them back.
        const { engine, library } = await makeLibrary({ withFx: true });
        const effects = engine.trackEffects;

        engine.trackEffects = null;
        library.loadPreset(anyPresetKey(library), 3);

        engine.trackEffects = effects;
        library.adoptTrackEffects();
        expect(library._trackPresets[3].sound.fx).not.toBeNull();

        const clean = effects.getTrackParams(3).distortion;
        effects.setDistortion(3, clean + 0.5);

        expect(library.isTrackModified(3)).toBe(true);
        expect(library.canRevertTrack(3)).toBe(true);

        library.revertTrack(3);
        expect(effects.getTrackParams(3).distortion).toBeCloseTo(clean, 5);
        expect(library.isTrackModified(3)).toBe(false);
    });

    it('leaves a knob moved before Play showing as moved', async () => {
        // Only the missing part is filled in. An edit made before the
        // audio started is a real edit, and filling the effects in must
        // not quietly adopt it as the baseline.
        const { engine, library } = await makeLibrary({ withFx: true });
        const effects = engine.trackEffects;

        engine.trackEffects = null;
        library.loadPreset(anyPresetKey(library), 5);
        engine.tracks[5].detune = 123;

        engine.trackEffects = effects;
        library.adoptTrackEffects();

        expect(library.isTrackModified(5)).toBe(true);
        expect(library.canRevertTrack(5)).toBe(true);
        library.revertTrack(5);
        expect(engine.tracks[5].detune).not.toBe(123);
    });
});
