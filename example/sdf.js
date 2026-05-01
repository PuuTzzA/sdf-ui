import { SdfCanvas, SdfLayer, SdfCommands, Twist } from "../src/scripts/sdf-ui.js";

const testtext = document.querySelector("#test-sdf-text")
document.getElementById("my-input").addEventListener("input", () => {
    let text = document.getElementById("my-input").value;
    testtext.innerHTML = text;
});

const compilingScreen = document.querySelector("#compiling-screen")
const testDiv = document.querySelector("#test-div");
const fpsDiv = document.querySelector("#fps-counter");
let lastFps = []

const target = document.querySelector("#target");
testDiv.addModifier(new Twist(target));

const SIZE = 90;
for (let i = 0; i < SIZE; i++) {
    lastFps.push(0);
}
let i = 0;

let mousePos = [0, 0];
window.addEventListener("mousemove", (e) => {
    mousePos = [e.clientX, e.clientY];
    testDiv.style.left = e.clientX + "px";
    testDiv.style.top = e.clientY + "px";
});

const loadStartTime = performance.now();
let lastTime = performance.now();
let fps = 0;


const sdfCanvas = new SdfCanvas("canvas");
sdfCanvas.onCompilationComplete = () => {
    compilingScreen.remove();
    const loadTime = performance.now() - loadStartTime;
    console.log("Until everything setup: " + (loadTime / 60000).toFixed(4) + " minutes, (" + loadTime.toFixed(4) + "ms)")
}
SdfCanvas.customElements = [
    [[-0.5, 0], [0.5, 0], [0.5, 0.5], [0.1, 0.2], [-1, 0.3]],
];
sdfCanvas.initWebgl(SdfCanvas.COMPILE_POLICY_ALSO_BLOCKING);

function gameLoop(now) {
    // FPS counter
    const delta = now - lastTime;
    fps = 1000 / delta;     // frames per second
    lastTime = now;

    lastFps[i % SIZE] = fps;
    i++

    const sum = lastFps.reduce((a, b) => a + b, 0);
    const avg = (sum / lastFps.length) || 0;

    fpsDiv.innerHTML = avg.toFixed(1);  // show FPS with 1 decimal

    // Draw Scene
    SdfCanvas.updateElements();
    sdfCanvas.draw();

    requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);