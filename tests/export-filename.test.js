import { describe, it, expect } from 'vitest';
import {
    resolveExportFilename,
    formatDate,
    abbreviateScale,
    DEFAULT_TEMPLATE
} from '../src/export/filename.js';

const NOW = new Date(2026, 8, 17, 14, 30, 25); // 17 September 2026, 14:30:25

describe('formatDate', () => {
    it('renders PHP date letters', () => {
        expect(formatDate(NOW, 'Y-m-d')).toBe('2026-09-17');
        expect(formatDate(NOW, 'His')).toBe('143025');
        expect(formatDate(NOW, 'y/n/j')).toBe('26/9/17');
        expect(formatDate(NOW, 'a')).toBe('pm');
    });

    it('passes unknown characters through, so separators survive', () => {
        expect(formatDate(NOW, 'Ymd-His')).toBe('20260917-143025');
    });
});

describe('resolveExportFilename', () => {
    const context = {
        designer: 'Dbenkei',
        project: 'MyTrack',
        track: 'Lead',
        scale: 'Cmin',
        bpm: 120,
        now: NOW
    };

    it('fills the default template', () => {
        expect(resolveExportFilename(context)).toBe(
            '20260917-143025_Dbenkei_MyTrack_Lead_Cmin_120bpm.wav'
        );
    });

    it('honours a custom template', () => {
        expect(
            resolveExportFilename({ ...context, template: '%Project%-%Track%', ext: 'flac' })
        ).toBe('MyTrack-Lead.flac');
    });

    it('collapses the gap an empty token leaves', () => {
        expect(resolveExportFilename({ ...context, track: '', scale: '' })).toBe(
            '20260917-143025_Dbenkei_MyTrack_120bpm.wav'
        );
    });

    it('fills in what the context does not say', () => {
        expect(resolveExportFilename({ template: '%Designer%_%Project%', now: NOW })).toBe(
            'Unknown_Untitled.wav'
        );
    });

    it('strips characters a file system would refuse', () => {
        expect(
            resolveExportFilename({ ...context, template: '%Project%', project: 'A/B:C*D?' })
        ).toBe('ABCD.wav');
    });

    it('never produces a nameless file', () => {
        expect(resolveExportFilename({ template: '%Track%', track: '', now: NOW })).toBe(
            'Untitled.wav'
        );
    });

    it('uses the extension it is given', () => {
        expect(resolveExportFilename({ ...context, template: '%Project%', ext: 'mid' })).toBe(
            'MyTrack.mid'
        );
    });

    it('offers a default template that uses every part of the context', () => {
        for (const token of ['%Date(', '%Designer%', '%Project%', '%Track%', '%Scale%', '%BPM%']) {
            expect(DEFAULT_TEMPLATE).toContain(token);
        }
    });
});

describe('abbreviateScale', () => {
    it('shortens the common scales', () => {
        expect(abbreviateScale('C', 'minor')).toBe('Cmin');
        expect(abbreviateScale('G', 'major')).toBe('Gmaj');
        expect(abbreviateScale('D', 'pentatonic_minor')).toBe('Dpentmin');
    });

    it('keeps an unknown scale name as it is', () => {
        expect(abbreviateScale('A', 'klezmer')).toBe('Aklezmer');
    });

    it('returns nothing without a key', () => {
        expect(abbreviateScale('', 'minor')).toBe('');
    });
});
