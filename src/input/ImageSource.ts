import type { Size } from "../utils/geometry";
import type { InputSource } from "./InputSource";
import type { CapturedFrame } from "./MediaTypes";

/**
 * A still image. The file is decoded once into an ImageBitmap (EXIF
 * orientation applied, matching what the <img> shows); every capture is a
 * cheap bitmap copy, so detection can be re-run when settings change.
 */
export class ImageSource implements InputSource {
    readonly kind = "image";

    private constructor(
        readonly element: HTMLImageElement,
        private readonly objectUrl: string,
        private bitmap: ImageBitmap | null
    ) {}

    static async load(file: File, element: HTMLImageElement): Promise<ImageSource> {
        const objectUrl = URL.createObjectURL(file);
        try {
            element.src = objectUrl;
            const [bitmap] = await Promise.all([
                createImageBitmap(file, { imageOrientation: "from-image" }),
                element.decode()
            ]);
            return new ImageSource(element, objectUrl, bitmap);
        } catch {
            URL.revokeObjectURL(objectUrl);
            element.removeAttribute("src");
            throw new Error(
                `Could not decode image: ${file.name}. The file may be corrupt or in an unsupported format.`
            );
        }
    }

    frameSize(): Size | null {
        return this.bitmap ? { width: this.bitmap.width, height: this.bitmap.height } : null;
    }

    currentTime(): number {
        return 0;
    }

    captureFrame(): Promise<CapturedFrame> {
        if (!this.bitmap) return Promise.reject(new Error("Image was released."));
        return createImageBitmap(this.bitmap);
    }

    dispose(): void {
        this.bitmap?.close();
        this.bitmap = null;
        URL.revokeObjectURL(this.objectUrl);
        this.element.removeAttribute("src");
    }
}
