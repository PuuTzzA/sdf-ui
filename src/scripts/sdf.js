import { initWebgl } from "./webgl/webgl.js";

initWebgl();


const testDiv = document.querySelector("#test-div");
console.log(testDiv)


let lastTime = performance.now();
let fps = 0;

function testDivFun(now) {
    const delta = now - lastTime;
    fps = 1000 / delta;     // frames per second
    lastTime = now;

    testDiv.innerHTML = fps.toFixed(1);  // show FPS with 1 decimal

    requestAnimationFrame(testDivFun);
}

requestAnimationFrame(testDivFun);


console.log("moin");