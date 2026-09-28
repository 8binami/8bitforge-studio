import { describe, it, expect, beforeEach } from 'vitest';
import { Studio, STUDIO_EVENTS } from '../src/studio.js';
import { EventBus } from '../src/core/event-bus.js';
import { FakeAudioContext } from './helpers/fake-audio-context.js';

function makeStudio() {
    const context = new FakeAudioContext();
    const bus = new EventBus();
    const ready = [];
    bus.on(STUDIO_EVENTS.ready, () => ready.push(true));

    return { context, bus, ready, studio: new Studio({ bus, createContext: () => context }) };
}

describe('Studio assembly', () => {
    let studio;

    beforeEach(() => {
        ({ studio } = makeStudio());
    });

    it('builds the modules and wires them to each other', () => {
        expect(studio.sequencer.audioEngine).toBe(studio.audioEngine);
        expect(studio.sequencer.arrangement).toBe(studio.arrangement);
        expect(studio.synthesizer.arpeggiator).toBe(studio.arpeggiator);
        expect(studio.audioEngine.masterFx).toBe(studio.masterFx);
        expect(studio.audioEngine.mastering).toBe(studio.mastering);
        expect(studio.generator.patternPresets).toBe(studio.patternPresets);
    });

    it('creates no audio before it is started', () => {
        expect(studio.isStarted).toBe(false);
        expect(studio.audioEngine.audioContext).toBeNull();
        expect(studio.trackEffects).toBeNull();
    });

    it('starts the audio once, and says so', async () => {
        const { studio: fresh, context, ready } = makeStudio();

        await fresh.start();
        const nodeCount = context.nodes.length;
        await fresh.start();

        expect(fresh.isStarted).toBe(true);
        expect(fresh.audioEngine.audioContext).toBe(context);
        expect(fresh.trackEffects).toBeTruthy();
        expect(context.nodes.length).toBe(nodeCount); // not built twice
        expect(ready).toHaveLength(1);
    });

    it('can undo the first thing a session does', () => {
        // Undo restores the entry before the current one, so the very
        // first edit is only reversible if something was recorded before
        // it. Without that the studio opens with one permanently stuck
        // change, which the Undo button now shows plainly.
        studio.sequencer.setBPM(150);
        studio.history.saveState('Tempo');

        expect(studio.history.canUndo()).toBe(true);
        studio.history.undo();
        expect(studio.sequencer.bpm).toBe(120);
    });

    it('gives the arpeggiator the sequencer tempo', () => {
        studio.sequencer.setBPM(90);
        studio.arpeggiator.updateSettings(0, { rate: '1/8' });

        expect(studio.arpeggiator.getIntervalMs(0)).toBeCloseTo(60000 / 90 / 2, 6);
    });
});

describe('Studio project state', () => {
    it('round-trips everything a project holds', async () => {
        const { studio } = makeStudio();
        await studio.start();

        studio.sequencer.setBPM(144);
        studio.sequencer.setCell(0, 3, 'G', 4);
        studio.sequencer.toggleMute(2);
        studio.audioEngine.setTrackFaderVolume(1, 0.7);
        studio.masterFx.setFilterEnabled(true);
        studio.mastering.setCompParam('enabled', true);
        studio.arrangement.setChain([0, 1, 0]);
        studio.generator.setGenre('synthwave');

        const saved = studio.getProjectState();

        const { studio: fresh } = makeStudio();
        await fresh.start();
        fresh.applyProjectState(saved);

        expect(fresh.sequencer.bpm).toBe(144);
        expect(fresh.sequencer.getCell(0, 3)).toEqual({ note: 'G', octave: 4 });
        expect(fresh.sequencer.getTrackStates(0)[2].mute).toBe(true);
        expect(fresh.audioEngine.mixerSettings[1].volume).toBe(0.7);
        expect(fresh.masterFx.filter.enabled).toBe(true);
        expect(fresh.mastering.compressor.enabled).toBe(true);
        expect(fresh.arrangement.getChain()).toEqual([0, 1, 0]);
        expect(fresh.generator.genre).toBe('synthwave');
    });

    it('survives a state of nothing', () => {
        const { studio } = makeStudio();
        expect(() => studio.applyProjectState(null)).not.toThrow();
    });

    it('forgets what was loaded on the tracks it just overwrote', async () => {
        const { studio } = makeStudio();
        await studio.start();

        const key = Object.keys(studio.instruments.presets)[0];
        studio.instruments.loadPreset(key, 0);
        expect(studio.instruments.getTrackPreset(0)).not.toBeNull();

        // A project brings its own eight sounds and no names for them. A
        // record left over would name a preset the track is not playing,
        // and offer to restore a sound from the project before this one.
        studio.applyProjectState(studio.blankProjectState());

        expect(studio.instruments.getTrackPreset(0)).toBeNull();
        expect(studio.instruments.isTrackModified(0)).toBe(false);
    });

    it('feeds the undo history', async () => {
        const { studio } = makeStudio();
        await studio.start();

        studio.sequencer.setCell(0, 0, 'C', 4);
        studio.history.saveState('First note');
        studio.sequencer.setCell(0, 1, 'E', 4);
        studio.history.saveState('Second note');

        studio.history.undo();

        expect(studio.sequencer.getCell(0, 1)).toBeNull();
        expect(studio.sequencer.getCell(0, 0)).toEqual({ note: 'C', octave: 4 });
    });
});

describe('Studio panic', () => {
    it('stops the clock and every sounding note', async () => {
        const { studio } = makeStudio();
        await studio.start();

        studio.sequencer.setCell(0, 0, 'C', 4);
        studio.sequencer.play();
        studio.audioEngine.playNote(440, 0, 4);

        studio.panic();

        expect(studio.sequencer.isPlaying).toBe(false);
        expect(studio.audioEngine.activeNotes.size).toBe(0);
        expect(studio.arpeggiator.activeArps.size).toBe(0);
    });
});

describe('Studio blank project', () => {
    it('is the studio as it is built, and can be applied back', () => {
        const { studio } = makeStudio();
        const blank = studio.blankProjectState();

        expect(blank.sequencer.bpm).toBe(studio.sequencer.bpm);
        // Not the silent 0 a missing gain node used to report.
        expect(blank.masterVolume).toBeGreaterThan(0);

        studio.sequencer.setBPM(180);
        studio.sequencer.setCell(0, 0, 'C', 4);

        studio.applyProjectState(studio.blankProjectState());

        expect(studio.sequencer.bpm).toBe(blank.sequencer.bpm);
        expect(studio.sequencer.getCell(0, 0)).toBeNull();
    });

    it('hands out a copy, so a new project cannot spoil the next one', () => {
        const { studio } = makeStudio();

        studio.blankProjectState().sequencer.bpm = 999;

        expect(studio.blankProjectState().sequencer.bpm).not.toBe(999);
    });
});

describe('Studio per-track effects in a project', () => {
    it('saves and restores them', async () => {
        const { studio } = makeStudio();
        await studio.start();
        studio.trackEffects.setTrackParams(3, { distortion: 0.6, reverbMix: 0.4 });

        const saved = studio.getProjectState();
        studio.trackEffects.setTrackParams(3, { distortion: 0 });
        studio.applyProjectState(saved);

        expect(studio.trackEffects.getTrackParams(3).distortion).toBeCloseTo(0.6, 4);
        expect(studio.trackEffects.getTrackParams(3).reverbMix).toBeCloseTo(0.4, 4);
    });

    it('holds onto a project opened before the audio started', async () => {
        const source = makeStudio().studio;
        await source.start();
        source.trackEffects.setTrackParams(1, { crushBits: 4 });
        const saved = source.getProjectState();

        // A second studio that has never played anything: no chain exists
        // for the effects to land on yet.
        const { studio } = makeStudio();
        expect(studio.trackEffects).toBeNull();
        studio.applyProjectState(saved);

        // Saving again in the meantime must not lose them.
        expect(studio.getProjectState().trackEffects[1].crushBits).toBe(4);

        await studio.start();
        expect(studio.trackEffects.getTrackParams(1).crushBits).toBe(4);
    });

    it('remembers which instrument is on each track', async () => {
        const source = makeStudio().studio;
        await source.start();
        const key = Object.keys(source.instruments.presets)[0];
        source.instruments.loadPreset(key, 3);
        const saved = source.getProjectState();

        const { studio } = makeStudio();
        await studio.start();
        studio.applyProjectState(saved);

        expect(studio.instruments.getTrackPresetName(3)).toBe(source.instruments.presets[key].name);
        expect(studio.instruments.isTrackModified(3)).toBe(false);
    });

    it('lets a track loaded from a project be put back', async () => {
        // The Reset button after opening a file. It goes back to the
        // sound the file carried, which is the only thing the file has.
        const source = makeStudio().studio;
        await source.start();
        source.instruments.loadPreset(Object.keys(source.instruments.presets)[0], 3);
        const saved = source.getProjectState();

        const { studio } = makeStudio();
        await studio.start();
        studio.applyProjectState(saved);

        const detune = studio.audioEngine.tracks[3].detune;
        studio.audioEngine.tracks[3].detune = detune + 33;

        expect(studio.instruments.canRevertTrack(3)).toBe(true);
        studio.instruments.revertTrack(3);
        expect(studio.audioEngine.tracks[3].detune).toBe(detune);
    });

    it('does not call a freshly opened project modified at the first press of Play', async () => {
        // The order a session happens in. A browser gives no audio
        // context until the user has done something, and opening a file
        // is not enough - so a project is normally opened before the
        // per-track effects chain exists, and a sound remembered then
        // has no effects in it. The moment the chain arrives, every
        // named track used to turn orange without being touched, with
        // a Reset button that could not put anything back.
        const source = makeStudio().studio;
        await source.start();
        source.instruments.loadPreset(Object.keys(source.instruments.presets)[0], 3);
        const saved = source.getProjectState();

        const { studio } = makeStudio();
        studio.applyProjectState(saved);
        expect(studio.instruments.isTrackModified(3)).toBe(false);

        await studio.start();

        expect(studio.instruments.isTrackModified(3)).toBe(false);
        expect(studio.instruments.canRevertTrack(3)).toBe(false);
    });

    it('notices an effect changed after Play on a project opened before it', async () => {
        // The other half of the same problem. Standing aside for
        // effects that could not be read is right only until there is a
        // chain to read them on; after that the snapshot has to take
        // them in, or every later change to them goes on being excused
        // and Reset never offers to put them back.
        const source = makeStudio().studio;
        await source.start();
        source.instruments.loadPreset(Object.keys(source.instruments.presets)[0], 1);
        const saved = source.getProjectState();

        const { studio } = makeStudio();
        studio.applyProjectState(saved);
        await studio.start();

        const clean = studio.trackEffects.getTrackParams(1).distortion;
        studio.trackEffects.setDistortion(1, clean + 0.6);

        expect(studio.instruments.isTrackModified(1)).toBe(true);
        expect(studio.instruments.canRevertTrack(1)).toBe(true);

        studio.instruments.revertTrack(1);
        expect(studio.trackEffects.getTrackParams(1).distortion).toBeCloseTo(clean, 5);
    });

    it('notices an effect changed after Play on a sound chosen before it', async () => {
        // Nothing stops someone opening the Studio window and picking
        // an instrument before playing a note. The sound is remembered
        // then, with no chain to read effects from, so the snapshot has
        // to take them in when the chain arrives - otherwise every
        // later change to them is excused for the rest of the session.
        const { studio } = makeStudio();
        studio.instruments.loadPreset(Object.keys(studio.instruments.presets)[0], 6);

        await studio.start();

        const clean = studio.trackEffects.getTrackParams(6).distortion;
        studio.trackEffects.setDistortion(6, clean + 0.6);

        expect(studio.instruments.isTrackModified(6)).toBe(true);
        expect(studio.instruments.canRevertTrack(6)).toBe(true);

        studio.instruments.revertTrack(6);
        expect(studio.trackEffects.getTrackParams(6).distortion).toBeCloseTo(clean, 5);
    });

    it('keeps the way back to the preset across undo and redo', async () => {
        // Every history entry runs through the same two functions a
        // project file does, and it carries the sound on the track -
        // the edited one, once a track has been edited. Rebuilding the
        // record from the engine rather than from the record would
        // make that edit its own baseline, so an undo through a
        // modified track turned a reversible edit into a permanent one
        // and took the Reset button away with it.
        const { studio } = makeStudio();
        await studio.start();

        studio.instruments.loadPreset(Object.keys(studio.instruments.presets)[0], 0);
        studio.history.saveState('Instrument');
        const clean = studio.audioEngine.tracks[0].detune;

        studio.audioEngine.tracks[0].detune = clean + 40;
        studio.history.saveState('Detune');
        expect(studio.instruments.canRevertTrack(0)).toBe(true);

        studio.history.undo();
        expect(studio.audioEngine.tracks[0].detune).toBe(clean);
        expect(studio.instruments.isTrackModified(0)).toBe(false);

        studio.history.redo();
        expect(studio.audioEngine.tracks[0].detune).toBe(clean + 40);
        expect(studio.instruments.isTrackModified(0)).toBe(true);
        expect(studio.instruments.canRevertTrack(0)).toBe(true);

        studio.instruments.revertTrack(0);
        expect(studio.audioEngine.tracks[0].detune).toBe(clean);
        expect(studio.instruments.isTrackModified(0)).toBe(false);
    });

    it('puts back every effect a sound arrived with, including the reverb decay', async () => {
        // The decay is in what a sound is, so it is in the fingerprint
        // that decides whether a track has been edited. Restoring ten
        // of the eleven effects meant a sound could be put back and
        // still not match itself, and the badge stayed on Modified with
        // a Reset button that did nothing more.
        const { studio } = makeStudio();
        await studio.start();
        studio.instruments.loadPreset(Object.keys(studio.instruments.presets)[0], 0);

        const decay = studio.trackEffects.getTrackParams(0).reverbDecay;
        studio.trackEffects.setReverbDecay(0, decay + 0.4);
        expect(studio.instruments.isTrackModified(0)).toBe(true);

        studio.instruments.revertTrack(0);

        expect(studio.trackEffects.getTrackParams(0).reverbDecay).toBeCloseTo(decay, 5);
        expect(studio.instruments.isTrackModified(0)).toBe(false);
        expect(studio.instruments.canRevertTrack(0)).toBe(false);
    });

    it('keeps each track arpeggio', async () => {
        const source = makeStudio().studio;
        source.arpeggiator.updateSettings(3, { mode: 'updown', rate: '1/16', octaves: 2 });
        const saved = source.getProjectState();

        const { studio } = makeStudio();
        studio.applyProjectState(saved);

        expect(studio.arpeggiator.getSettings(3)).toMatchObject({
            mode: 'updown',
            rate: '1/16',
            octaves: 2
        });
        // And a track nobody touched comes back at rest rather than
        // keeping what the last project put there.
        expect(studio.arpeggiator.getSettings(0).mode).toBe('off');
    });

    it('starts a new project with every chain doing nothing', async () => {
        const { studio } = makeStudio();
        await studio.start();
        studio.trackEffects.setTrackParams(0, { distortion: 0.9, delayMix: 0.5 });

        studio.applyProjectState(studio.blankProjectState());

        expect(studio.trackEffects.getTrackParams(0).distortion).toBe(0);
        expect(studio.trackEffects.getTrackParams(0).delayMix).toBe(0);
    });
});
