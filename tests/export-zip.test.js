import { describe, it, expect } from 'vitest';
import { createZip, crc32 } from '../src/export/zip.js';

const bytes = (text) => new TextEncoder().encode(text);

function readUint32(zip, offset) {
    return new DataView(zip.buffer, zip.byteOffset).getUint32(offset, true);
}

function readUint16(zip, offset) {
    return new DataView(zip.buffer, zip.byteOffset).getUint16(offset, true);
}

describe('crc32', () => {
    it('matches the known checksum of a reference string', () => {
        // The canonical CRC-32 test vector
        expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
    });

    it('is zero for no data', () => {
        expect(crc32(new Uint8Array(0))).toBe(0);
    });
});

describe('createZip', () => {
    it('writes a local header per entry', () => {
        const zip = createZip([{ name: 'a.txt', data: bytes('hello') }]);

        expect(readUint32(zip, 0)).toBe(0x04034b50);
        expect(readUint16(zip, 8)).toBe(0); // stored, not deflated
        expect(readUint32(zip, 18)).toBe(5); // compressed size
        expect(readUint32(zip, 22)).toBe(5); // uncompressed size
        expect(readUint16(zip, 26)).toBe(5); // name length
    });

    it('stores the payload verbatim', () => {
        const payload = bytes('hello');
        const zip = createZip([{ name: 'a.txt', data: payload }]);
        const start = 30 + 5;

        expect([...zip.slice(start, start + payload.length)]).toEqual([...payload]);
    });

    it('checksums each entry', () => {
        const payload = bytes('hello');
        const zip = createZip([{ name: 'a.txt', data: payload }]);

        expect(readUint32(zip, 14)).toBe(crc32(payload));
    });

    it('ends with a directory listing every entry', () => {
        const zip = createZip([
            { name: 'one.wav', data: bytes('11111') },
            { name: 'two.wav', data: bytes('2222222') }
        ]);

        const end = zip.length - 22;
        expect(readUint32(zip, end)).toBe(0x06054b50);
        expect(readUint16(zip, end + 8)).toBe(2); // entries on this disk
        expect(readUint16(zip, end + 10)).toBe(2); // entries in total

        const directoryOffset = readUint32(zip, end + 16);
        const directorySize = readUint32(zip, end + 12);
        expect(readUint32(zip, directoryOffset)).toBe(0x02014b50);
        expect(directoryOffset + directorySize).toBe(end);
    });

    it('points each directory entry at its local header', () => {
        const first = { name: 'one.wav', data: bytes('11111') };
        const second = { name: 'two.wav', data: bytes('2222222') };
        const zip = createZip([first, second]);

        const end = zip.length - 22;
        const directoryOffset = readUint32(zip, end + 16);
        const firstEntrySize = 46 + 'one.wav'.length;

        expect(readUint32(zip, directoryOffset + 42)).toBe(0); // first file, at the top
        expect(readUint32(zip, directoryOffset + firstEntrySize + 42)).toBe(
            30 + first.name.length + first.data.length
        );
    });

    it('accepts an ArrayBuffer as well as a typed array', () => {
        const zip = createZip([{ name: 'a.bin', data: bytes('abcd').buffer }]);
        expect(readUint32(zip, 18)).toBe(4);
    });

    it('writes an empty but valid archive', () => {
        const zip = createZip([]);

        expect(zip.length).toBe(22);
        expect(readUint32(zip, 0)).toBe(0x06054b50);
        expect(readUint16(zip, 8)).toBe(0);
    });
});
