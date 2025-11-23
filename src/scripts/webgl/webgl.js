import { initBuffers } from "./init-buffers.js";
import { drawScene } from "./draw-scene.js";

function resizeCanvasToDisplaySize(canvas, gl) {
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = Math.round(canvas.clientWidth * dpr);
    const displayHeight = Math.round(canvas.clientHeight * dpr);

    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
        canvas.width = displayWidth;
        canvas.height = displayHeight;

        // Also update WebGL viewport so it covers the full new buffer
        gl.viewport(0, 0, displayWidth, displayHeight);
    }
}

async function loadShadersFromDisk() {
    const responseVertex = await fetch("./src/shaders/vertex.glsl");
    const responseFragment = await fetch("./src/shaders/fragment.glsl");

    return {
        vertexSource: await responseVertex.text(),
        fragmentSource: await responseFragment.text(),
    };
}

function loadShader(gl, type, source) {
    const shader = gl.createShader(type); // either vertex or fragment

    // Send the source to the shader object
    gl.shaderSource(shader, source);

    // Compile the shader program
    gl.compileShader(shader);

    // See if it compiled successfully
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        alert(
            `An error occurred compiling the shaders: ${gl.getShaderInfoLog(shader)}`,
        );
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function initShaderProgram(gl, vsSource, fsSource) {
    const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vsSource);
    const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource);

    // Create the shader program
    const shaderProgram = gl.createProgram(); // program of vertex + fragment shader
    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);

    // If creating the shader program failed, alert
    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        alert(
            `Unable to initialize the shader program: ${gl.getProgramInfoLog(
                shaderProgram,
            )}`,
        );
        return null;
    }

    return shaderProgram;
}

async function initWebgl() {
    const canvas = document.querySelector("#canvas");
    // Initialize the GL context
    const gl = canvas.getContext("webgl2");

    // Only continue if WebGL is available and working
    if (gl === null) {
        alert(
            "Unable to initialize WebGL. Your browser or machine may not support it.",
        );
        return;
    }

    resizeCanvasToDisplaySize(canvas, gl);

    // Set clear color to black, fully opaque
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    // Clear the color buffer with specified clear color
    gl.clear(gl.COLOR_BUFFER_BIT);

    const { vertexSource, fragmentSource } = await loadShadersFromDisk();

    // Initialize a shader program; this is where all the lighting
    // for the vertices and so forth is established.
    const shaderProgram = initShaderProgram(gl, vertexSource, fragmentSource);

    // Collect all the info needed to use the shader program.
    // Look up which attribute our shader program is using
    // for aVertexPosition and look up uniform locations.
    const programInfo = {
        canvas: canvas,
        program: shaderProgram,
        maxBufferSize: 256,
        attribLocations: {
            vertexPosition: 0,
            vertexUv: gl.getAttribLocation(shaderProgram, "aVertexUv"),
        },
        uniformLocations: {
            resolution: gl.getUniformLocation(shaderProgram, "resolution"),
            geometryBlock: gl.getUniformBlockIndex(shaderProgram, "GeometryBlock"),
            shadingBlock: gl.getUniformBlockIndex(shaderProgram, "ShadingBlock")
        },
    };

    // Here's where we call the routine that builds all the
    // objects we'll be drawing.
    const buffers = initBuffers(gl, programInfo);

    const maxBytes = gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE);
    console.log("Max UBO Size:", maxBytes, "bytes");

    const maxBindings = gl.getParameter(gl.MAX_UNIFORM_BUFFER_BINDINGS);
    console.log("max bindings:", maxBindings); // Usually 24, 36, or higher

    const maxFragBlocks = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_BLOCKS);
    console.log("max fragment blocks:", maxFragBlocks)

    let dpr = window.devicePixelRatio || 1;
    dpr = 1.;
    console.log("aa;", window.devicePixelRatio)
    console.log("bb;", [Math.round(canvas.clientWidth * dpr / 2), Math.round(canvas.clientHeight * dpr / 2)])
    //requestAnimationFrame(() => drawScene(gl, programInfo, buffers));
    drawScene(gl, programInfo, buffers, [Math.round(canvas.clientWidth * dpr / 2), Math.round(canvas.clientHeight * dpr / 2)]);
    window.addEventListener("resize", () => { resizeCanvasToDisplaySize(canvas, gl); drawScene(gl, programInfo, buffers, [Math.round(canvas.clientWidth * dpr / 2), Math.round(canvas.clientHeight * dpr / 2)]) });



    function loop() {
        drawScene(gl, programInfo, buffers, [Math.round(canvas.clientWidth * dpr / 2), Math.round(canvas.clientHeight * dpr / 2)]);
        requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);

    /*     document.addEventListener("mousemove", (e) => {
            let x = e.clientX;
            let y = e.clientY;
            drawScene(gl, programInfo, buffers, [x, y]);
        }) */
}



export { initWebgl }