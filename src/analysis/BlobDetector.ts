import type { CV } from "@techstark/opencv-js";
import type { BlobData } from "../tracking/TrackTypes";
import type { AnalysisSettings } from "./AnalysisTypes";

type OpenCv = CV & { onRuntimeInitialized?: () => void; Mat?: unknown };

/**
 * Lazily imports @techstark/opencv-js and resolves once its WASM
 * runtime is ready. The package's default export is either a Promise
 * (module already invoked) or a Module object awaiting
 * onRuntimeInitialized, depending on how the runtime happened to load
 * — see the package README for this exact pattern.
 */
async function loadCv(): Promise<OpenCv> {
    const imported = (await import("@techstark/opencv-js")) as unknown as { default: unknown };
    const candidate = imported.default;

    if (candidate && typeof (candidate as Promise<unknown>).then === "function") {
        return (await candidate) as OpenCv;
    }

    const cv = candidate as OpenCv;
    if (cv.Mat) return cv;

    return new Promise((resolve) => {
        cv.onRuntimeInitialized = () => resolve(cv);
    });
}

/**
 * Detects blobs in a single frame via OpenCV.js: grayscale -> optional
 * blur -> threshold -> morphology -> findContours -> bounding rects.
 * A blob is a detected region only, not a classified object — semantic
 * labeling happens later, on tracks, not here.
 */
export class BlobDetector {
    private cv: OpenCv | null = null;
    private loading: Promise<OpenCv> | null = null;

    isReady(): boolean {
        return this.cv !== null;
    }

    private ensureReady(): Promise<OpenCv> {
        if (this.cv) return Promise.resolve(this.cv);
        if (!this.loading) {
            this.loading = loadCv().then((cv) => {
                this.cv = cv;
                return cv;
            });
        }
        return this.loading;
    }

    async detect(imageData: ImageData, settings: AnalysisSettings): Promise<BlobData[]> {
        const cv = await this.ensureReady();
        return detectBlobs(cv, imageData, settings);
    }
}

function detectBlobs(cv: OpenCv, imageData: ImageData, settings: AnalysisSettings): BlobData[] {
    const { width, height } = imageData;
    const frameArea = width * height;

    const src = cv.matFromImageData(imageData);
    const gray = new cv.Mat();
    const binary = new cv.Mat();
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    let kernel: ReturnType<OpenCv["getStructuringElement"]> | null = null;

    try {
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

        if (settings.blurRadius > 0) {
            const kernelSize = 2 * Math.round(settings.blurRadius) + 1;
            cv.GaussianBlur(gray, gray, new cv.Size(kernelSize, kernelSize), 0);
        }

        cv.threshold(gray, binary, settings.threshold * 255, 255, cv.THRESH_BINARY);

        if (settings.morphologyStrength > 0) {
            kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
            cv.morphologyEx(
                binary,
                binary,
                cv.MORPH_OPEN,
                kernel,
                new cv.Point(-1, -1),
                Math.round(settings.morphologyStrength)
            );
        }

        cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        const blobs: BlobData[] = [];
        for (let i = 0; i < contours.size(); i++) {
            const contour = contours.get(i);
            const area = cv.contourArea(contour);
            const normalizedArea = area / frameArea;

            if (normalizedArea < settings.minBlobArea || normalizedArea > settings.maxBlobArea) {
                contour.delete();
                continue;
            }

            const rect = cv.boundingRect(contour);
            contour.delete();
            blobs.push({
                id: blobs.length + 1,
                x: rect.x / width,
                y: rect.y / height,
                width: rect.width / width,
                height: rect.height / height,
                centerX: (rect.x + rect.width / 2) / width,
                centerY: (rect.y + rect.height / 2) / height,
                area
            });
        }

        return blobs;
    } finally {
        src.delete();
        gray.delete();
        binary.delete();
        contours.delete();
        hierarchy.delete();
        kernel?.delete();
    }
}
