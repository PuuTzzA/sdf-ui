import { SdfCanvas } from "./webgl/sdf-canvas.js";

const sdfCanvas = new SdfCanvas("canvas");
sdfCanvas.initWebgl();

/* const sdfCanvas2 = new SdfCanvas("canvas2", [1]);
sdfCanvas2.initWebgl(); */

const testtext = document.querySelector("#test-sdf-text")

document.getElementById("myInput").addEventListener("input", () => {
    let text = document.getElementById("myInput").value;
    testtext.innerHTML = text;
});

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

const loadStartTime = performance.now();
let firstTime = true;
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
        if (firstTime) {
            compilingScreen.remove();
            const loadTime = performance.now() - loadStartTime; 
            console.log("Until everything setup: " + (loadTime / 60000).toFixed(4) +   " minutes, (" + loadTime.toFixed(4) + "ms)")
            firstTime = false;
        }
        sdfCanvas.draw();
    }

    /* if (sdfCanvas2.ready) {
        sdfCanvas2.draw();
    } */

    requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);