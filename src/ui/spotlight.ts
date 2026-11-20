/**
 * The page ground is flat dark; around the pointer it is a little lighter, like
 * a weak flashlight. The light is one fixed element moved with a transform
 * (compositor only), updated at most once per frame.
 */
export function createSpotlight(): HTMLElement {
    const element = document.createElement("div");
    element.className = "spotlight";
    element.setAttribute("aria-hidden", "true");

    let frame = 0;
    let x = 0;
    let y = 0;
    const place = () => {
        frame = 0;
        element.style.setProperty("--spot-x", `${x}px`);
        element.style.setProperty("--spot-y", `${y}px`);
    };
    document.addEventListener(
        "pointermove",
        (event) => {
            x = event.clientX;
            y = event.clientY;
            if (!frame) frame = requestAnimationFrame(place);
        },
        { passive: true }
    );
    // The light leaves with the pointer.
    document.documentElement.addEventListener("pointerleave", () => {
        x = y = -10_000;
        place();
    });
    return element;
}
