import { describe, it, expect, beforeEach } from 'vitest';
import { AudioEngine } from '../src/audio/audio-engine.js';
import { Sequencer, SEQUENCER_EVENTS } from '../src/sequencer/sequencer.js';
import { Automation, AUTOMATION_PARAMS } from '../src/sequencer/automation.js';
import { EventBus } from '../src/core/event-bus.js';
import { FakeAudioContext } from './helpers/fake-audio-context.js';

async function makeAutomation() {
    const context = new FakeAudioContext();
    const engine = new AudioEngine({ createContext: () => context });
    await engine.init();

    const bus = new EventBus();
    const sequencer = new Sequencer(engine, { bus });
    const automation = new Automation(sequencer, { bus });

    /** Fire the step event the sequencer would emit when a step is heard. */
    const hearStep = (step) => bus.emit(SEQUENCER_EVENTS.step, { step, playedTracks: [] });

    return { engine, bus, sequencer, automation, hearStep };
}

describe('Automation recording', () => {
    let automation;
    let sequencer;

    beforeEach(async () => {
        ({ automation, sequencer } = await makeAutomation());
    });

    it('starts empty, with a lane per parameter', () => {
        expect(Object.keys(automation.automationData)).toHaveLength(8);
        expect(Object.keys(automation.automationData[0]).sort()).toEqual(
            [...AUTOMATION_PARAMS].sort()
        );
        expect(automation.hasAutomation(0, 'volume')).toBe(false);
    });

    it('records moves on the armed track only', () => {
        automation.startRecording(1);

        expect(automation.recordMove(1, 'volume', 0.8, 4)).toBe(true);
        expect(automation.recordMove(2, 'volume', 0.2, 4)).toBe(false);

        automation.stopRecording();

        expect(automation.hasAutomation(1, 'volume')).toBe(true);
        expect(automation.hasAutomation(2, 'volume')).toBe(false);
    });

    it('records nothing while disarmed', () => {
        expect(automation.recordMove(0, 'volume', 0.5, 0)).toBe(false);
    });

    it('stamps a move with the step playing now', () => {
        sequencer.currentStep = 7;
        automation.startRecording(0);
        automation.recordMove(0, 'volume', 0.4);
        automation.stopRecording();

        expect(automation.getAutomationSteps(0, 'volume')).toEqual([7]);
    });

    it('keeps only the last move on a step', () => {
        automation.startRecording(0);
        automation.recordMove(0, 'volume', 0.2, 3);
        automation.recordMove(0, 'volume', 0.9, 3);
        automation.stopRecording();

        expect(automation.automationData[0].volume[3]).toBe(0.9);
    });

    it('drops the buffer between takes', () => {
        automation.startRecording(0);
        automation.recordMove(0, 'volume', 0.3, 1);
        automation.startRecording(0); // a second take without committing
        automation.stopRecording();

        expect(automation.hasAutomation(0, 'volume')).toBe(false);
    });
});

describe('Automation playback', () => {
    let engine;
    let automation;
    let hearStep;

    beforeEach(async () => {
        ({ engine, automation, hearStep } = await makeAutomation());
    });

    it('stays silent until playback is enabled', () => {
        automation.startRecording(0);
        automation.recordMove(0, 'volume', 0.9, 2);
        automation.stopRecording();

        hearStep(2);

        expect(engine.tracks[0].volume).not.toBe(0.9);
    });

    it('writes a track parameter when its step comes round', () => {
        automation.startRecording(0);
        automation.recordMove(0, 'volume', 0.9, 2);
        automation.recordMove(0, 'detune', 25, 3);
        automation.stopRecording();
        automation.enablePlayback();

        hearStep(2);
        expect(engine.tracks[0].volume).toBe(0.9);

        hearStep(3);
        expect(engine.tracks[0].detune).toBe(25);
    });

    it('writes an envelope parameter', () => {
        automation.startRecording(1);
        automation.recordMove(1, 'attack', 0.5, 0);
        automation.stopRecording();
        automation.enablePlayback();

        hearStep(0);

        expect(engine.envelopes[1].attack).toBe(0.5);
    });

    it('leaves steps without a recorded value alone', () => {
        const before = engine.tracks[0].volume;
        automation.startRecording(0);
        automation.recordMove(0, 'volume', 0.9, 2);
        automation.stopRecording();
        automation.enablePlayback();

        hearStep(1);

        expect(engine.tracks[0].volume).toBe(before);
    });

    it('toggles playback', () => {
        expect(automation.togglePlayback()).toBe(true);
        expect(automation.togglePlayback()).toBe(false);
    });

    it('stops listening once disposed', () => {
        automation.startRecording(0);
        automation.recordMove(0, 'volume', 0.9, 0);
        automation.stopRecording();
        automation.enablePlayback();

        automation.dispose();
        hearStep(0);

        expect(engine.tracks[0].volume).not.toBe(0.9);
    });
});

describe('Automation lanes', () => {
    let automation;

    beforeEach(async () => {
        ({ automation } = await makeAutomation());
        automation.startRecording(0);
        automation.recordMove(0, 'volume', 0.2, 0);
        automation.recordMove(0, 'volume', 1, 4);
        automation.recordMove(0, 'detune', 10, 2);
        automation.stopRecording();
    });

    it('lists the recorded steps in order', () => {
        expect(automation.getAutomationSteps(0, 'volume')).toEqual([0, 4]);
    });

    it('interpolates between two recorded values', () => {
        expect(automation.interpolate(0, 'volume', 0)).toBe(0.2);
        expect(automation.interpolate(2, 'volume', 0)).toBeCloseTo(0.6, 10);
        expect(automation.interpolate(4, 'volume', 0)).toBe(1);
    });

    it('holds the last value past the end of the lane', () => {
        expect(automation.interpolate(9, 'volume', 0)).toBe(1);
    });

    it('holds the first value before the start of the lane', () => {
        expect(automation.interpolate(0, 'detune', 0)).toBe(10);
    });

    it('returns nothing for an empty lane', () => {
        expect(automation.interpolate(3, 'reverbMix', 0)).toBeNull();
    });

    it('clears one lane, or a whole track', () => {
        automation.clearAutomation(0, 'volume');
        expect(automation.hasAutomation(0, 'volume')).toBe(false);
        expect(automation.hasAutomation(0, 'detune')).toBe(true);

        automation.clearAllAutomation(0);
        expect(automation.hasAutomation(0, 'detune')).toBe(false);
    });
});

describe('Automation persistence', () => {
    it('round-trips its data', async () => {
        const { automation } = await makeAutomation();
        automation.startRecording(3);
        automation.recordMove(3, 'glide', 0.4, 6);
        automation.stopRecording();
        automation.enablePlayback();
        const saved = automation.serialize();

        const { automation: fresh } = await makeAutomation();
        fresh.deserialize(saved);

        expect(fresh.serialize()).toEqual(saved);
        expect(fresh.automationData[3].glide[6]).toBe(0.4);
        expect(fresh.isPlaying).toBe(true);
    });

    it('does not share lanes with the state it was given', async () => {
        const { automation } = await makeAutomation();
        automation.startRecording(0);
        automation.recordMove(0, 'volume', 0.5, 1);
        automation.stopRecording();

        const saved = automation.serialize();
        automation.clearAllAutomation(0);

        expect(saved.automationData[0].volume[1]).toBe(0.5);
    });

    it('fills in the lanes a partial save leaves out', async () => {
        const { automation } = await makeAutomation();

        automation.deserialize({ automationData: { 0: { volume: { 2: 0.7 } } } });

        expect(automation.automationData[0].volume[2]).toBe(0.7);
        expect(automation.automationData[5].detune).toEqual({});
    });
});
