/**
 * Project and kit covers.
 *
 * A cover is stored inside the project file as a data URL, so it travels with
 * the file and needs no second store. That only works if it stays small: a
 * photo straight from a phone would be several megabytes of base64 in a file
 * meant to be readable and diffable.
 *
 * So a picked image is centre-cropped to a square and re-encoded as a JPEG a
 * few kilobytes wide. That is larger than anywhere it is shown: 38 px in the
 * topbar, 32 px in a listing, 84 px in the edit window: with enough left
 * over for a screen at twice the pixel density.
 */

/** The side of the stored square, in pixels. */
export const COVER_SIZE = 192;

/** Below this, a JPEG of a flat pixel-art cover starts to smear. */
const COVER_QUALITY = 0.85;

/**
 * Shown where a project or a kit has no cover of its own.
 *
 * Relative, with no leading slash. The build sets `base: './'` so that one
 * bundle serves from a web root, from a subpath, and from Electron's app://
 * origin; a leading slash resolves against the origin root instead and
 * leaves a broken image everywhere but `/`.
 */
export const DEFAULT_COVER = 'img/kits/default.svg';

/**
 * The cover of something the community shared: the picture the API stores
 * for it (cover_url), or null. Only an https address is taken, since it is
 * drawn into the page.
 *
 * @param {{cover_url?: unknown}} item  a row of GET /v1/shared
 * @returns {string|null}
 */
export function sharedCoverUrl(item) {
    const url = item?.cover_url;
    return typeof url === 'string' && /^https:\/\/[^\s"'<>]+$/.test(url) ? url : null;
}

/**
 * Read a picked file and shrink it to a storable cover.
 *
 * @param {File} file
 * @returns {Promise<string|null>} a data URL, or null if it is not an image
 */
export async function coverFromFile(file) {
    if (!file || !file.type.startsWith('image/')) return null;

    const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error('Could not read the image'));
        reader.readAsDataURL(file);
    });

    return toCover(dataUrl);
}

/**
 * Centre-crop a square out of an image and re-encode it small.
 *
 * @param {string} dataUrl
 * @param {number} [size]
 * @returns {Promise<string>} the shrunk cover, or the input if it cannot be read
 */
export function toCover(dataUrl, size = COVER_SIZE) {
    return new Promise((resolve) => {
        const image = new Image();

        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;

            const context = canvas.getContext('2d');
            if (!context) return resolve(dataUrl);

            // Scale so the shorter side fills the square, then centre what is
            // left: cropping the edges of a cover beats letterboxing it.
            const scale = Math.max(size / image.width, size / image.height);
            const width = image.width * scale;
            const height = image.height * scale;
            context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);

            resolve(canvas.toDataURL('image/jpeg', COVER_QUALITY));
        };

        // An image the browser will not decode is stored as it came: the file
        // is the user's, and refusing it outright helps nobody.
        image.onerror = () => resolve(dataUrl);
        image.src = dataUrl;
    });
}
