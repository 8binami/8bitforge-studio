/**
 * ZIP writing.
 *
 * Exporting stems or patterns produces a handful of files; they travel as one
 * archive. Entries are stored uncompressed: the payload is already-encoded
 * audio, which deflate would only make slower without making smaller.
 *
 * Writing the ~60 lines of the format here avoids pulling in a ZIP library
 * for that one use, and keeps the output byte-for-byte predictable.
 */

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_DIRECTORY_SIGNATURE = 0x06054b50;
const VERSION_NEEDED = 20; // 2.0: the baseline every reader supports
const METHOD_STORE = 0; // no compression

/**
 * Build a ZIP archive.
 *
 * @param {Array<{name: string, data: Uint8Array|ArrayBuffer}>} entries
 * @returns {Uint8Array}
 */
export function createZip(entries) {
    const parts = [];
    const directory = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBytes = new TextEncoder().encode(entry.name);
        const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
        const checksum = crc32(data);

        const localHeader = new Uint8Array(30 + nameBytes.length);
        const local = new DataView(localHeader.buffer);
        local.setUint32(0, LOCAL_HEADER_SIGNATURE, true);
        local.setUint16(4, VERSION_NEEDED, true);
        local.setUint16(6, 0, true); // flags
        local.setUint16(8, METHOD_STORE, true);
        local.setUint16(10, 0, true); // modification time
        local.setUint16(12, 0, true); // modification date
        local.setUint32(14, checksum, true);
        local.setUint32(18, data.length, true); // compressed size
        local.setUint32(22, data.length, true); // uncompressed size
        local.setUint16(26, nameBytes.length, true);
        local.setUint16(28, 0, true); // extra field length
        localHeader.set(nameBytes, 30);

        const centralEntry = new Uint8Array(46 + nameBytes.length);
        const central = new DataView(centralEntry.buffer);
        central.setUint32(0, CENTRAL_HEADER_SIGNATURE, true);
        central.setUint16(4, VERSION_NEEDED, true); // version made by
        central.setUint16(6, VERSION_NEEDED, true); // version needed
        central.setUint16(8, 0, true);
        central.setUint16(10, METHOD_STORE, true);
        central.setUint16(12, 0, true);
        central.setUint16(14, 0, true);
        central.setUint32(16, checksum, true);
        central.setUint32(20, data.length, true);
        central.setUint32(24, data.length, true);
        central.setUint16(28, nameBytes.length, true);
        central.setUint16(30, 0, true); // extra field length
        central.setUint16(32, 0, true); // comment length
        central.setUint16(34, 0, true); // disk number
        central.setUint16(36, 0, true); // internal attributes
        central.setUint32(38, 0, true); // external attributes
        central.setUint32(42, offset, true); // where the local header sits
        centralEntry.set(nameBytes, 46);

        parts.push(localHeader, data);
        directory.push(centralEntry);
        offset += localHeader.length + data.length;
    }

    const directoryOffset = offset;
    let directorySize = 0;
    for (const entry of directory) {
        parts.push(entry);
        directorySize += entry.length;
    }

    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, END_OF_DIRECTORY_SIGNATURE, true);
    endView.setUint16(4, 0, true); // this disk
    endView.setUint16(6, 0, true); // disk with the directory
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, directorySize, true);
    endView.setUint32(16, directoryOffset, true);
    endView.setUint16(20, 0, true); // comment length
    parts.push(end);

    return concat(parts);
}

/**
 * Build a ZIP from blobs.
 * @param {Array<{name: string, blob: Blob}>} entries
 * @returns {Promise<Blob>}
 */
export async function createZipBlob(entries) {
    const loaded = [];
    for (const entry of entries) {
        loaded.push({ name: entry.name, data: new Uint8Array(await entry.blob.arrayBuffer()) });
    }
    return new Blob([createZip(loaded)], { type: 'application/zip' });
}

/** CRC-32 as ZIP defines it. */
export function crc32(data) {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function concat(chunks) {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
        out.set(chunk, at);
        at += chunk.length;
    }
    return out;
}
