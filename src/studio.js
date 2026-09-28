/**
 * The studio.
 *
 * Assembles the ported modules into one object and wires them to each other:
 * the engine holds the audio graph, the sequencer plays it, the rest hangs
 * off those two. Nothing here touches the DOM: the interface reads this
 * object and listens to the bus.
 *
 * The audio context is not created until `start()` is called, because a
 * browser only allows one from a user gesture.
 */

import { AudioEngine } from './audio/audio-engine.js';
import { Synthesizer } from './audio/synthesizer.js';
import { TrackEffects } from './audio/track-effects.js';
import { MasterFx } from './audio/master-fx.js';
import { MasteringEngine } from './audio/mastering.js';
import { Metronome } from './audio/metronome.js';
import { Sequencer, SEQUENCER_EVENTS } from './sequencer/sequencer.js';
import { Arrangement } from './sequencer/arrangement.js';
import { Automation } from './sequencer/automation.js';
import { Recorder } from './sequencer/recorder.js';
import { FxAutomation } from './automation/fx-automation.js';
import { MixerAutomation } from './automation/mixer-automation.js';
import { Arpeggiator } from './compose/arpeggiator.js';
import { Generator } from './compose/generator.js';
import { PatternPresets } from './compose/pattern-presets.js';
import { InstrumentLibrary } from './compose/instrument-library.js';
import { UndoRedo } from './core/undo-redo.js';
import { bus as sharedBus } from './core/event-bus.js';

export const STUDIO_EVENTS = Object.freeze({
    ready: 'studio:ready'
});

export class Studio {
    /**
     * @param {object} [options]
     * @param {import('./core/event-bus.js').EventBus} [options.bus]
     * @param {() => BaseAudioContext} [options.createContext]  audio context factory
     */
    constructor({ bus = sharedBus, createContext = null } = {}) {
        this.bus = bus;
        this.isStarted = false;

        this.audioEngine = new AudioEngine({ createContext });
        this.synthesizer = new Synthesizer(this.audioEngine, { bus });
        this.sequencer = new Sequencer(this.audioEngine, { bus });

        this.arrangement = new Arrangement(this.sequencer, { bus });
        this.sequencer.arrangement = this.arrangement;

        // The click is booked with the step, not played when the step is
        // announced: announcing happens at the moment the step is heard,
        // which is already too late to schedule anything.
        this.metronome = new Metronome(this.audioEngine);
        bus.on(SEQUENCER_EVENTS.scheduled, ({ step, time }) => this.metronome.onStep(step, time));

        this.arpeggiator = new Arpeggiator(this.audioEngine, {
            getTempo: () => this.sequencer.bpm
        });
        this.synthesizer.arpeggiator = this.arpeggiator;

        this.automation = new Automation(this.sequencer, { bus });
        this.recorder = new Recorder(this.sequencer, { bus });
        this.patternPresets = new PatternPresets(this.sequencer, this.audioEngine, { bus });
        this.generator = new Generator(this.sequencer, {
            bus,
            patternPresets: this.patternPresets
        });
        this.instruments = new InstrumentLibrary(this.audioEngine, this.synthesizer, {
            arpeggiator: this.arpeggiator
        });

        // Master FX and mastering need the audio context, so they are created
        // now but only build their graph once the engine is running.
        this.masterFx = new MasterFx(this.audioEngine, { bus });
        this.mastering = new MasteringEngine(this.audioEngine, { bus });
        this.audioEngine.masterFx = this.masterFx;
        this.audioEngine.mastering = this.mastering;

        // Envelopes written against the arrangement: one set for the master
        // effects and the mastering stage, one for the console.
        this.fxAutomation = new FxAutomation({
            masterFx: this.masterFx,
            mastering: this.mastering,
            arrangement: this.arrangement,
            sequencer: this.sequencer,
            bus
        });
        this.mixerAutomation = new MixerAutomation({
            audioEngine: this.audioEngine,
            arrangement: this.arrangement,
            sequencer: this.sequencer,
            bus
        });

        this.history = new UndoRedo({
            capture: () => this.getProjectState(),
            restore: (state) => this.applyProjectState(state),
            bus
        });

        /** Per-track effects, once the audio context exists. */
        this.trackEffects = null;
        /**
         * Per-track effects belonging to a project opened before the audio
         * started. The chain is built on the first press of Play, so until
         * then there is nowhere to put them and they wait here.
         * @type {Array<object>|null}
         */
        this._pendingTrackEffects = null;

        // A new project is the studio exactly as it is built. Capturing it
        // here rather than writing a second list of defaults means the two
        // can never drift: whatever a module starts at is what New gives.
        this._blankState = structuredClone(this.getProjectState());

        // Undo steps back to an entry that is already recorded, so the
        // history needs one before anything has happened: without it the
        // first edit of a session lands at index 0 with nothing behind it
        // and stays there for good. Opening a project and starting a new
        // one seed their own the same way.
        this.history.saveState('Session start');
    }

    /** @returns {object} the state a new project starts from */
    blankProjectState() {
        return structuredClone(this._blankState);
    }

    /**
     * Start the audio. Must be called from a user gesture: browsers refuse an
     * audio context otherwise, and a silent studio is a confusing one.
     */
    async start() {
        if (this.isStarted) return;

        await this.audioEngine.init();

        this.trackEffects = new TrackEffects(this.audioEngine);
        this.audioEngine.trackEffects = this.trackEffects;
        await this.trackEffects.ready;

        // Now there is somewhere to put what a project brought with it.
        if (this._pendingTrackEffects) {
            this.trackEffects.deserialize(this._pendingTrackEffects);
            this._pendingTrackEffects = null;
        }

        // A project is normally opened before anything is played, so the
        // sounds the library remembered a moment ago were remembered
        // without their effects - there was no chain to read. Now there
        // is, and the snapshots take in the part that was missing.
        this.instruments.adoptTrackEffects();

        this.masterFx.applyAllToAudio();
        this.mastering.applyAllToAudio();

        this.isStarted = true;
        this.bus.emit(STUDIO_EVENTS.ready);
    }

    /** Everything that belongs in a project file. */
    getProjectState() {
        return {
            version: '1.2',
            sequencer: this.sequencer.getState(),
            tracks: this.audioEngine.tracks,
            envelopes: this.audioEngine.envelopes,
            vibrato: this.audioEngine.vibrato,
            mixerSettings: this.audioEngine.mixerSettings,
            masterVolume: this.audioEngine.getMasterVolume(),
            arrangement: this.arrangement.serialize(),
            automation: this.automation.serialize(),
            masterFx: this.masterFx.serialize(),
            fxAutomation: this.fxAutomation.serialize(),
            mixerAutomation: this.mixerAutomation.serialize(),
            mastering: this.mastering.serialize(),
            generator: this.generator.getState(),
            arpeggiator: this.arpeggiator.serialize(),
            // An instrument's effects are as much a part of how a track
            // sounds as its waveform is, so they belong in the file. Before
            // the audio starts there is no chain to read, only whatever a
            // project brought in.
            trackEffects:
                this.trackEffects?.serialize() ??
                this._pendingTrackEffects ??
                TrackEffects.defaultState(),
            // Which instrument is on each track: where each came from,
            // and the sound it arrived as. The arrival sound is what
            // Reset goes back to, and it is not the sound in the three
            // arrays above whenever a track has been edited - so it is
            // written, or there would be nothing to go back to after a
            // reload, and an undo through an edited track would make the
            // edit permanent.
            trackPresets: this.instruments.captureTrackPresets()
        };
    }

    /** Put a project state back, as saved. */
    applyProjectState(state) {
        if (!state) return;

        if (state.sequencer) this.sequencer.setState(state.sequencer);
        if (state.tracks) this.audioEngine.tracks = structuredClone(state.tracks);
        if (state.envelopes) this.audioEngine.envelopes = structuredClone(state.envelopes);
        if (state.vibrato) this.audioEngine.vibrato = structuredClone(state.vibrato);
        // Replaced whole rather than only when present: a project that
        // carries no mixer is a project with the mixer at unity, and
        // inheriting the last one's faders is a quiet way of hearing the
        // wrong thing. Then written onto the graph, which assigning the
        // record does not do.
        this.audioEngine.mixerSettings = structuredClone(
            state.mixerSettings ?? AudioEngine.defaultMixerSettings()
        );
        this.audioEngine.applyMixerToAudio();
        if (typeof state.masterVolume === 'number') {
            this.audioEngine.setMasterVolume(state.masterVolume);
        }

        this.arrangement.deserialize(state.arrangement);
        this.automation.deserialize(state.automation);
        this.masterFx.deserialize(state.masterFx);
        this.fxAutomation.deserialize(state.fxAutomation);
        this.mixerAutomation.deserialize(state.mixerAutomation);
        // A project saved before the bypass was written plays through it.
        this.mastering.setBypass(state.mastering?.bypassed === true);
        this.mastering.deserialize(state.mastering);
        this.generator.loadState(state.generator);
        this.arpeggiator.deserialize(state.arpeggiator);

        const effects = state.trackEffects ?? TrackEffects.defaultState();
        if (this.trackEffects) this.trackEffects.deserialize(effects);
        else this._pendingTrackEffects = effects;

        // The eight tracks were just overwritten, so whatever the library
        // thought was on them describes a project that is no longer open.
        // The records the state carries take their place, sounds and all,
        // which is why nothing here depends on the order of the lines
        // above it.
        this.instruments.rememberTrackPresets(state.trackPresets);
    }

    /** Silence everything and stop the clock. */
    panic() {
        this.sequencer.stop();
        this.arpeggiator.stopAll();
        this.audioEngine.stopAllNotes();
    }
}
