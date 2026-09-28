import { describe, it, expect } from 'vitest';
import { compareVersions, latestVersion, nextVersion } from '../src/platform/update-check.js';

const LIST = {
    platforms: [
        {
            id: 'windows',
            enabled: true,
            builds: [
                { url: 'https://cdn.8binami.com/download/8BitForge/win/2.3.3/8BitForge-2.3.3-win-x64.exe' },
                { url: 'https://cdn.8binami.com/download/8BitForge/win/2.10.0/8BitForge-2.10.0-portable-win.exe' }
            ]
        },
        { id: 'linux', enabled: false, builds: [{ url: 'https://cdn.8binami.com/download/8BitForge/linux/9.0.0/a.AppImage' }] },
        { id: 'macos', builds: [{ url: 'https://example.com/no-version-here.dmg' }] }
    ]
};

describe('update check', () => {
    it('compares versions by their numbers, not as text', () => {
        expect(compareVersions('2.10.0', '2.9.9')).toBe(1);
        expect(compareVersions('2.3.3', '2.3.3')).toBe(0);
        expect(compareVersions('2.3.3', '2.4')).toBe(-1);
        expect(compareVersions('2.3.3-beta', '2.3.3')).toBe(0);
    });

    it('reads the newest version of a platform from the folders of its builds', () => {
        expect(latestVersion(LIST, 'windows')).toBe('2.10.0');
    });

    it('has nothing for a disabled platform, an unknown one, or builds without a version', () => {
        expect(latestVersion(LIST, 'linux')).toBeNull();
        expect(latestVersion(LIST, 'macos')).toBeNull();
        expect(latestVersion(LIST, undefined)).toBeNull();
        expect(latestVersion(null, 'windows')).toBeNull();
    });

    it('makes up the next version for the development simulation', () => {
        expect(nextVersion('2.3.3')).toBe('2.3.4');
        expect(nextVersion('2.9')).toBe('2.9.1');
    });
});
