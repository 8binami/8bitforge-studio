/**
 * The unit conversions the panels do.
 *
 * The widgets read in milliseconds, percent and decibels; the audio modules
 * take seconds, 0..1 and plain gain. These are the two places that
 * translation happens, and a slip in either would be silent: a slider that
 * writes the wrong number still moves.
 */

import { describe, it, expect } from 'vitest';
import { MASTER_FX_PARAMS } from '../src/ui/master-fx-panel.js';
import { describeArc, volumeToDecibels } from '../src/ui/knob.js';

describe('master FX units', () => {
    it('converts what the sliders read into what the engine takes', () => {
        expect(MASTER_FX_PARAMS['delay:time'].toNatural(250)).toBeCloseTo(0.25);
        expect(MASTER_FX_PARAMS['delay:feedback'].toNatural(30)).toBeCloseTo(0.3);
        expect(MASTER_FX_PARAMS['reverb:decay'].toNatural(5)).toBeCloseTo(0.5);
        expect(MASTER_FX_PARAMS['chorus:rate'].toNatural(2.5)).toBeCloseTo(2.5);
    });

    it('reads the engine back onto the sliders', () => {
        for (const [key, units] of Object.entries(MASTER_FX_PARAMS)) {
            const original = 42;
            expect(units.toUi(units.toNatural(original)), key).toBeCloseTo(original);
        }
    });

    it('prints each value in its own unit', () => {
        expect(MASTER_FX_PARAMS['delay:time'].format(250)).toBe('250ms');
        expect(MASTER_FX_PARAMS['delay:mix'].format(50)).toBe('50%');
        expect(MASTER_FX_PARAMS['reverb:decay'].format(5)).toBe('0.5s');
        expect(MASTER_FX_PARAMS['chorus:rate'].format(1)).toBe('1.0');
    });
});

describe('the mixer knob', () => {
    it('prints a fader position as decibels', () => {
        expect(volumeToDecibels(1)).toBe('+0.0dB');
        expect(volumeToDecibels(0.5)).toBe('-6.0dB');
        expect(volumeToDecibels(0)).toBe('-∞');
    });

    it('draws nothing when a bipolar knob sits at zero', () => {
        expect(describeArc(16, 16, 14, 90, 90)).toBe('');
    });

    it('takes the long way round past a half turn', () => {
        // The sweep is 270°: the large-arc flag has to be set, or the path
        // cuts across the knob instead of round it.
        expect(describeArc(16, 16, 14, 225, -45)).toContain(' 1 1 ');
        expect(describeArc(16, 16, 14, 225, 135)).toContain(' 0 1 ');
    });
});
