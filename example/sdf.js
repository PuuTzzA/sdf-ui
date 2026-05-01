import { SdfCanvas, SdfLayer, SdfCommands, Twist } from "../src/scripts/sdf-ui.js";

// ╔══════════════════════════════════════════════════════════╗
// ║                       Sdf Canvas                         ║
// ╚══════════════════════════════════════════════════════════╝
const loadStartTime = performance.now();

const sdfCanvas = new SdfCanvas("canvas", {
    onCompilationComplete: () => {
        compilingScreen.remove();
        const loadTime = performance.now() - loadStartTime;
        console.log("Until everything setup: " + (loadTime / 60000).toFixed(4) + " minutes, (" + loadTime.toFixed(4) + "ms)")
    }
});

SdfCanvas.customElements = [
    [[-0.5, 0], [0.5, 0], [0.5, 0.5], [0.1, 0.2], [-1, 0.3]],
    [[-0.5, 0], [0.5, 0], [0.5, 0.5]],
];

sdfCanvas.initWebgl(SdfCanvas.COMPILE_POLICY_ALSO_BLOCKING);

// ╔══════════════════════════════════════════════════════════╗
// ║                 Interactive Elements                     ║
// ╚══════════════════════════════════════════════════════════╝
const testtext = document.querySelector("#test-sdf-text")
document.getElementById("my-input").addEventListener("input", () => {
    let text = document.getElementById("my-input").value;
    testtext.innerHTML = text;
});

const compilingScreen = document.querySelector("#compiling-screen")
const mouseFollower = document.querySelector("#test-div");
const fpsDiv = document.querySelector("#fps-counter");

const target = document.querySelector("#target");
mouseFollower.addModifier(new Twist(target));

let mousePos = [0, 0];
window.addEventListener("mousemove", (e) => {
    mousePos = [e.clientX, e.clientY];
    mouseFollower.style.left = e.clientX + "px";
    mouseFollower.style.top = e.clientY + "px";
});

const SIZE = 90;
let lastFps = new Float32Array(SIZE);
let i = 0;
let lastTime = performance.now();
let fps = 0;

// ╔══════════════════════════════════════════════════════════╗
// ║                         Loop                             ║
// ╚══════════════════════════════════════════════════════════╝
function gameLoop(now) {
    // FPS counter
    fps = 1000 / (now - lastTime);     // frames per second
    lastFps[i++ % SIZE] = fps;
    const avg = (lastFps.reduce((a, b) => a + b, 0) / lastFps.length) || 0;
    fpsDiv.innerHTML = avg.toFixed(1);  // show FPS with 1 decimal
    lastTime = now;

    // Draw Scene
    SdfCanvas.update();
    sdfCanvas.draw();

    requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);