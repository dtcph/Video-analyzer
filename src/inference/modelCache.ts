/** The subset of the Cache API this module uses (injectable for tests). */
export interface CacheLike {
    match(request: string): Promise<Response | undefined>;
    put(request: string, response: Response): Promise<void>;
    keys(): Promise<readonly Request[]>;
    delete(request: Request | string): Promise<boolean>;
}

export interface ExpectedFile {
    sha256: string;
    bytes: number;
}

export interface ModelFetchOptions {
    cache: CacheLike | null;
    fetchFn?: typeof fetch;
    onProgress?: (loadedBytes: number, totalBytes: number) => void;
}

export interface ModelFetchResult {
    bytes: Uint8Array;
    fromCache: boolean;
}

export const MODEL_CACHE_NAME = "object-counter-models-v1";

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Cache key: the file URL plus its expected hash, so a re-exported model never matches an old entry. */
export function cacheKeyFor(url: string, sha256: string): string {
    const key = new URL(url);
    key.searchParams.set("sha256", sha256);
    return key.href;
}

/**
 * Loads a model file: from the Cache API when a verified copy exists, else
 * from the network with progress, verified against the manifest's SHA-256
 * and then cached. Stale cache entries of the same file are removed.
 * `url` must be absolute. Without a cache (e.g. storage blocked) it still
 * works, just without reuse.
 */
export async function fetchModel(
    url: string,
    expected: ExpectedFile,
    options: ModelFetchOptions
): Promise<ModelFetchResult> {
    const { cache, fetchFn = fetch, onProgress } = options;
    const key = cacheKeyFor(url, expected.sha256);

    if (cache) {
        const cached = await cache.match(key).catch(() => undefined);
        if (cached) {
            const bytes = new Uint8Array(await cached.arrayBuffer());
            if ((await sha256Hex(bytes)) === expected.sha256) {
                onProgress?.(bytes.byteLength, bytes.byteLength);
                return { bytes, fromCache: true };
            }
            await cache.delete(key).catch(() => false);
        }
    }

    const response = await fetchFn(url);
    if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status} for ${url}`);
    const bytes = await readWithProgress(response, expected.bytes, onProgress);
    const actual = await sha256Hex(bytes);
    if (actual !== expected.sha256) {
        throw new Error(
            `Model file ${url} failed its checksum (expected ${expected.sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…).`
        );
    }

    if (cache) {
        try {
            await removeStaleEntries(cache, url, key);
            await cache.put(
                key,
                new Response(bytes as Uint8Array<ArrayBuffer>, {
                    headers: { "Content-Type": "application/octet-stream" }
                })
            );
        } catch {
            // Quota exceeded or storage blocked: the model still works for this session.
        }
    }
    return { bytes, fromCache: false };
}

async function readWithProgress(
    response: Response,
    expectedBytes: number,
    onProgress?: (loaded: number, total: number) => void
): Promise<Uint8Array> {
    const header = Number(response.headers.get("Content-Length"));
    // A compressed transfer reports the compressed length; the manifest size is the reliable total.
    const total = expectedBytes > 0 ? expectedBytes : header;
    if (!response.body) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        onProgress?.(bytes.byteLength, total || bytes.byteLength);
        return bytes;
    }

    let buffer = new Uint8Array(total > 0 ? total : 1 << 20);
    let loaded = 0;
    const reader = response.body.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (loaded + value.byteLength > buffer.byteLength) {
            const grown = new Uint8Array(Math.max(buffer.byteLength * 2, loaded + value.byteLength));
            grown.set(buffer.subarray(0, loaded));
            buffer = grown;
        }
        buffer.set(value, loaded);
        loaded += value.byteLength;
        onProgress?.(loaded, Math.max(total, loaded));
    }
    return loaded === buffer.byteLength ? buffer : buffer.slice(0, loaded);
}

async function removeStaleEntries(cache: CacheLike, url: string, keepKey: string): Promise<void> {
    const path = new URL(url).pathname;
    for (const request of await cache.keys()) {
        if (request.url !== keepKey && new URL(request.url).pathname === path) await cache.delete(request);
    }
}
