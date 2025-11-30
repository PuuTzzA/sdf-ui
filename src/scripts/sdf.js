import { SdfCanvas } from "./webgl/sdf-canvas.js";

const sdfCanvas = new SdfCanvas("canvas");
sdfCanvas.initWebgl();

const testDiv = document.querySelector("#test-div");

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
    testDiv.innerHTML = fps.toFixed(1);  // show FPS with 1 decimal

    // Draw Scene
    if (sdfCanvas.ready) {
        sdfCanvas.draw();
    }

    requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);

console.log(testDiv.dataset.layerIndex)
console.log("moin");