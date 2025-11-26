import { initBuffers } from "./init-buffers.js";

class SdfCanvas {
    static MAX_UNIFORM_BUFFER_SIZE = 256;
    static VEC4_PER_ELEMENT = 2;

    static GEOMETRY_BLOCK_UNIFORM_BUFFER_BINDING_INDEX = 0;
    static SHADING_BLOCK_UNIFORM_BUFFER_BINDING_INDEX = 1;

    static LayerOperation = Object.freeze({
        UNION: 0,
        SUBTRACTION: 1,
        INTERSECTION: 2,
        XOR: 3,
        SMOOTH_UNION: 4,
        SMOOTH_SUBTRACTION: 5,
        SMOOTH_INTERSECTION: 6,
    })

    static trackedElements = []

    static addTrackedElement(element) {
        this.trackedElements.push(element);
        this.trackedElements.sort((a, b) => (a.dataset.layerIndex - b.dataset.layerIndex));

        console.log(this.trackedElements);
    }

    constructor(canvasName) {
        this.canvasName = canvasName;
        this.ready = false;

        this.canvas;
        this.gl;
        this.programInfo;
        this.buffers;
        this.geometryBuffer = new Float32Array(SdfCanvas.MAX_UNIFORM_BUFFER_SIZE * 4);
        this.shadingBuffer = new Float32Array(SdfCanvas.MAX_UNIFORM_BUFFER_SIZE * 4);
    }

    async initWebgl() {
        this.canvas = document.querySelector(this.canvasName);

        // Initialize the GL context
        this.gl = canvas.getContext("webgl2");

        // Only continue if WebGL is available and working
        if (this.gl === null) {
            alert(
                "Unable to initialize WebGL. Your browser or machine may not support it.",
            );
            return;
        }

        this.resizeCanvasToDisplaySize();

        // Set clear color to black, fully opaque
        this.gl.clearColor(0.0, 0.0, 0.0, 1.0);
        // Clear the color buffer with specified clear color
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);

        const { vertexSource, fragmentSource } = await SdfCanvas.loadShadersFromDisk();

        // Initialize a shader program; this is where all the lighting
        // for the vertices and so forth is established.
        const shaderProgram = this.initShaderProgram(vertexSource, fragmentSource);

        // Collect all the info needed to use the shader program.
        // Look up which attribute our shader program is using
        // for aVertexPosition and look up uniform locations.
        this.programInfo = {
            canvas: this.canvas,
            program: shaderProgram,
            attribLocations: {
                vertexPosition: 0,
                vertexUv: this.gl.getAttribLocation(shaderProgram, "aVertexUv"),
            },
            uniformLocations: {
                resolution: this.gl.getUniformLocation(shaderProgram, "resolution"),
                geometryBlock: this.gl.getUniformBlockIndex(shaderProgram, "GeometryBlock"),
                shadingBlock: this.gl.getUniformBlockIndex(shaderProgram, "ShadingBlock")
            },
        };

        // Here's where we call the routine that builds all the
        // objects we'll be drawing.
        this.buffers = initBuffers(this.gl, this.programInfo);

        /* const maxBytes = this.gl.getParameter(this.gl.MAX_UNIFORM_BLOCK_SIZE);
        console.log("Max UBO Size:", maxBytes, "bytes");
    
        const maxBindings = this.gl.getParameter(this.gl.MAX_UNIFORM_BUFFER_BINDINGS);
        console.log("max bindings:", maxBindings); // Usually 24, 36, or higher
    
        const maxFragBlocks = this.gl.getParameter(this.gl.MAX_FRAGMENT_UNIFORM_BLOCKS);
        console.log("max fragment blocks:", maxFragBlocks) */

        let dpr = window.devicePixelRatio || 1;
        dpr = 1.;
        console.log("aa;", window.devicePixelRatio)
        console.log("bb;", [Math.round(this.canvas.clientWidth * dpr / 2), Math.round(this.canvas.clientHeight * dpr / 2)])
        //requestAnimationFrame(() => drawScene(gl, programInfo, buffers));

        window.addEventListener("resize", () => {
            this.resizeCanvasToDisplaySize();
            this.draw([0, 0]);
        });

        this.ready = true;
    }

    draw() {
        this.gl.clearColor(1.0, 0.0, 1.0, 1.0); // Clear to black, fully opaque
        this.gl.clearDepth(1.0); // Clear everything
        this.gl.enable(this.gl.DEPTH_TEST); // Enable depth testing
        this.gl.depthFunc(this.gl.LEQUAL); // Near things obscure far things

        // Clear the canvas before we start drawing on it.
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);

        // Tell WebGL how to pull out the positions from the position
        // buffer into the vertexPosition attribute.
        //setPositionAttribute(gl, buffers, programInfo);
        //setColorAttribute(gl, buffers, programInfo);
        //setUvAttribute(gl, buffers, programInfo);
        // Tell WebGL which indices to use to index the vertices
        this.gl.bindVertexArray(this.buffers.vao);

        // Tell WebGL to use our program when drawing
        this.gl.useProgram(this.programInfo.program);

        // Set the shader uniforms
        this.gl.uniform2f(this.programInfo.uniformLocations.resolution, this.programInfo.canvas.offsetWidth, this.programInfo.canvas.offsetHeight);

        // Set uniform buffer values
        this.updateUniformBuffers();

        this.gl.bindBuffer(this.gl.UNIFORM_BUFFER, this.buffers.geometryBuffer);
        this.gl.bufferSubData(this.gl.UNIFORM_BUFFER, 0, this.geometryBuffer);

        this.gl.bindBuffer(this.gl.UNIFORM_BUFFER, this.buffers.shadingBuffer);
        this.gl.bufferSubData(this.gl.UNIFORM_BUFFER, 0, this.shadingBuffer);

        // Draw Scene
        {
            const offset = 0;
            const vertexCount = 4;
            this.gl.drawArrays(this.gl.TRIANGLE_STRIP, offset, vertexCount);
        }
    }

    updateUniformBuffers() {
        const resolution = [this.canvas.clientWidth, this.canvas.clienHeight];
        const oneOverresX = 1 / resolution[0];

        for (let i = 0; i < SdfCanvas.trackedElements.length; i++) {
            const elementIdx = i * SdfCanvas.VEC4_PER_ELEMENT * 4;
            const element = SdfCanvas.trackedElements[i];

            // Geometry Information
            const rect = element.getBoundingClientRect();
            const halfWidth = element.offsetWidth * oneOverresX / 2;
            const halfHeight = element.offsetHeight * oneOverresX / 2;

            this.geometryBuffer[elementIdx + 0] = rect.left * oneOverresX + halfWidth; // x
            this.geometryBuffer[elementIdx + 1] = rect.top * oneOverresX + halfHeight; // y
            this.geometryBuffer[elementIdx + 2] = parseFloat(getComputedStyle(element).getPropertyValue("--depth")); // z
            this.geometryBuffer[elementIdx + 3] = 0; // Element id

            this.geometryBuffer[elementIdx + 4] = halfWidth; // width 
            this.geometryBuffer[elementIdx + 5] = halfHeight; // height 
            this.geometryBuffer[elementIdx + 6] = 0.1; // depth
            this.geometryBuffer[elementIdx + 7] = 0.005; // corner radius

            // Shading Information
            this.shadingBuffer[elementIdx + 0] = 0.; // unused for now
            this.shadingBuffer[elementIdx + 1] = 0.; // unused for now
            this.shadingBuffer[elementIdx + 2] = 0.; // unused for now
            this.shadingBuffer[elementIdx + 3] = 0.; // unused for now

            this.shadingBuffer[elementIdx + 4] = 0.; // unused for now
            this.shadingBuffer[elementIdx + 5] = 0.; // unused for now
            this.shadingBuffer[elementIdx + 6] = 0.; // unused for now
            this.shadingBuffer[elementIdx + 7] = 0.; // unused for now
        }
    }

    resizeCanvasToDisplaySize() {
        const dpr = window.devicePixelRatio || 1;
        const displayWidth = Math.round(this.canvas.clientWidth * dpr);
        const displayHeight = Math.round(this.canvas.clientHeight * dpr);

        if (this.canvas.width !== displayWidth || this.canvas.height !== displayHeight) {
            this.canvas.width = displayWidth;
            this.canvas.height = displayHeight;

            // Also update WebGL viewport so it covers the full new buffer
            this.gl.viewport(0, 0, displayWidth, displayHeight);
        }
    }

    initShaderProgram(vsSource, fsSource) {
        const vertexShader = this.loadShader(this.gl.VERTEX_SHADER, vsSource);
        const fragmentShader = this.loadShader(this.gl.FRAGMENT_SHADER, fsSource);

        // Create the shader program
        const shaderProgram = this.gl.createProgram(); // program of vertex + fragment shader
        this.gl.attachShader(shaderProgram, vertexShader);
        this.gl.attachShader(shaderProgram, fragmentShader);
        this.gl.linkProgram(shaderProgram);

        // If creating the shader program failed, alert
        if (!this.gl.getProgramParameter(shaderProgram, this.gl.LINK_STATUS)) {
            alert(
                `Unable to initialize the shader program: ${this.gl.getProgramInfoLog(
                    shaderProgram,
                )}`,
            );
            return null;
        }

        return shaderProgram;
    }

    loadShader(type, source) {
        const shader = this.gl.createShader(type); // either vertex or fragment

        // Send the source to the shader object
        this.gl.shaderSource(shader, source);

        // Compile the shader program
        this.gl.compileShader(shader);

        // See if it compiled successfully
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            alert(
                `An error occurred compiling the shaders: ${this.gl.getShaderInfoLog(shader)}`,
            );
            this.gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    static async loadShadersFromDisk() {
        const responseVertex = await fetch("./src/shaders/vertex.glsl");
        const responseFragment = await fetch("./src/shaders/fragment.glsl");

        return {
            vertexSource: await responseVertex.text(),
            fragmentSource: await responseFragment.text(),
        };
    }
}

export { SdfCanvas }