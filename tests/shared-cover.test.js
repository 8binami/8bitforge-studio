import { describe, it, expect } from 'vitest';
import { sharedCoverUrl } from '../src/ui/cover-image.js';

describe('the cover of a shared source', () => {
    it('is the picture the API keeps for it', () => {
        const url = 'https://api.8bitforge.com/u/covers/12-0123456789abcdef.webp';
        expect(sharedCoverUrl({ cover_url: url })).toBe(url);
    });

    it('is nothing when there is none, or when it is not a plain https address', () => {
        expect(sharedCoverUrl({ cover_url: null })).toBeNull();
        expect(sharedCoverUrl({})).toBeNull();
        expect(sharedCoverUrl({ cover_url: 'javascript:alert(1)' })).toBeNull();
        expect(sharedCoverUrl({ cover_url: 'http://example.com/a.webp' })).toBeNull();
        expect(sharedCoverUrl({ cover_url: 'https://a.example/x.webp" onerror="alert(1)' })).toBeNull();
    });
});
