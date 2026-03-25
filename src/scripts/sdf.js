import { SdfCanvas } from "./webgl/sdf-canvas.js";
import { TextMeter } from "./helper/text-meter.js"

const sdfCanvas = new SdfCanvas("canvas");
sdfCanvas.initWebgl();

/* const sdfCanvas2 = new SdfCanvas("canvas2", [1]);
sdfCanvas2.initWebgl(); */

const testtext = document.querySelector(".sdf-text")
console.log(testtext.getWordRects())
console.log(testtext.textContent.replace(/\s+/g, '').length)


const compilingScreen = document.querySelector("#compiling-screen")
const testDiv = document.querySelector("#test-div");
const fpsDiv = document.querySelector("#fps-counter");
let lastFps = []

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

let lastTime = performance.now();
let fps = 0;

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
    if (sdfCanvas.ready) {
        compilingScreen.remove();
        sdfCanvas.draw();
    }

    /* if (sdfCanvas2.ready) {
        sdfCanvas2.draw();
    } */

    requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);

console.log(testDiv.dataset.layerIndex)
console.log("moin");