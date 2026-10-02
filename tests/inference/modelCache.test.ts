import { describe, expect, it, vi } from "vitest";
import type { CacheLike } from "../../src/inference/modelCache";
import { cacheKeyFor, fetchModel, sha256Hex } from "../../src/inference/modelCache";

class MemoryCache implements CacheLike {
    readonly entries = new Map<string, Uint8Array>();
    async match(request: string) {
        const bytes = this.entries.get(request);
        return bytes ? new Response(bytes as Uint8Array<ArrayBuffer>) : undefined;
    }
    async put(request: string, response: Response) {
        this.entries.set(request, new Uint8Array(await response.arrayBuffer()));
    }
    async keys() {
        return [...this.entries.keys()].map((url) => new Request(url));
    }
    async delete(request: Request | string) {
        return this.entries.delete(typeof request === "string" ? request : request.url);
    }
}

const URL_ = "https://example.test/models/m.onnx";
const payload = new Uint8Array(3000).map((_, i) => i % 251);

/** A fetch that streams the payload in 1000-byte chunks. */
function streamingFetch(body: Uint8Array) {
    return vi.fn(async () => {
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                for (let i = 0; i < body.length; i += 1000) controller.enqueue(body.slice(i, i + 1000));
                controller.close();
            }
        });
        return new Response(stream, { status: 200 });
    }) as unknown as typeof fetch;
}

describe("fetchModel", async () => {
    const sha256 = await sha256Hex(payload);

    it("downloads with progress, verifies, and caches under a hash-specific key", async () => {
        const cache = new MemoryCache();
        const progress: number[] = [];
        const result = await fetchModel(
            URL_,
            { sha256, bytes: payload.length },
            {
                cache,
                fetchFn: streamingFetch(payload),
                onProgress: (loaded, total) => progress.push(loaded / total)
            }
        );
        expect(result.fromCache).toBe(false);
        expect(result.bytes).toEqual(payload);
        expect(progress).toEqual([1 / 3, 2 / 3, 1]);
        expect([...cache.entries.keys()]).toEqual([cacheKeyFor(URL_, sha256)]);
    });

    it("serves a verified cached copy without touching the network", async () => {
        const cache = new MemoryCache();
        await fetchModel(URL_, { sha256, bytes: payload.length }, { cache, fetchFn: streamingFetch(payload) });
        const fetchFn = streamingFetch(payload);
        const result = await fetchModel(URL_, { sha256, bytes: payload.length }, { cache, fetchFn });
        expect(result.fromCache).toBe(true);
        expect(fetchFn).not.toHaveBeenCalled();
    });

    it("replaces a corrupt cache entry and drops stale versions of the same file", async () => {
        const cache = new MemoryCache();
        cache.entries.set(cacheKeyFor(URL_, sha256), new Uint8Array([1, 2, 3]));
        cache.entries.set(cacheKeyFor(URL_, "old"), new Uint8Array([4]));
        const result = await fetchModel(
            URL_,
            { sha256, bytes: payload.length },
            { cache, fetchFn: streamingFetch(payload) }
        );
        expect(result.fromCache).toBe(false);
        expect([...cache.entries.keys()]).toEqual([cacheKeyFor(URL_, sha256)]);
    });

    it("rejects a download whose checksum does not match", async () => {
        const tampered = payload.slice();
        tampered[0] ^= 1;
        await expect(
            fetchModel(URL_, { sha256, bytes: payload.length }, { cache: null, fetchFn: streamingFetch(tampered) })
        ).rejects.toThrow(/checksum/);
    });

    it("reports HTTP errors", async () => {
        const fetchFn = vi.fn(async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
        await expect(fetchModel(URL_, { sha256, bytes: 1 }, { cache: null, fetchFn })).rejects.toThrow(/HTTP 404/);
    });
});
