import { initBuffers } from "./init-buffers.js";

class SdfCanvas {
    static MAX_TRACKED_ELEMENTS = 256;
    static VEC4_PER_ELEMENT = 2;

    static MAX_LAYERS = 16;

    static GEOMETRY_BLOCK_UNIFORM_BUFFER_BINDING_INDEX = 0;
    static SHADING_BLOCK_UNIFORM_BUFFER_BINDING_INDEX = 1;

    static ElementType = Object.freeze({
        SPHERE: 0,
        BOX: 1,
        ROUND_BOX: 2,
    });

    static LayerOperation = Object.freeze({
        UNION: 0,
        SUBTRACTION: 1,
        INTERSECTION: 2,
        XOR: 3,
        SMOOTH_UNION: 4,
        SMOOTH_SUBTRACTION: 5,
        SMOOTH_INTERSECTION: 6,
    })

    static instantiatedCanvases = [];

    static trackedElements = [];

    static addTrackedElement(element) {
        if (this.trackedElements.length > SdfCanvas.MAX_TRACKED_ELEMENTS) {
            throw f`Cannot track more elemtns than the maximum amount (${SdfCanvas.MAX_TRACKED_ELEMENTS}).`;
        }

        this.trackedElements.push(element);
        this.trackedElements.sort((a, b) => (a.dataset.layerIndex - b.dataset.layerIndex));

        this.instantiatedCanvases.forEach((c) => {
            c.updateLayers();
        });

        console.log("addtrackedelements", this.trackedElements);
    }

    static sortTrackedElements() {
        this.trackedElements.sort((a, b) => (a.dataset.layerIndex - b.dataset.layerIndex));

        this.instantiatedCanvases.forEach((c) => {
            c.updateLayers();
        });

        console.log("sort, sorted elements", this.trackedElements);
    }

    constructor(canvasName) {
        SdfCanvas.instantiatedCanvases.push(this);

        this.canvasName = canvasName;
        this.ready = false;

        this.canvas;
        this.gl;
        this.programInfo;
        this.buffers;
        this.geometryBuffer = new Float32Array(SdfCanvas.MAX_TRACKED_ELEMENTS * 4);
        this.shadingBuffer = new Float32Array(SdfCanvas.MAX_TRACKED_ELEMENTS * 4);

        this.layers = [
            { layerOperation: SdfCanvas.LayerOperation.UNION, elementsInLayer: 0, smoothingFactor: 0 },
            { layerOperation: SdfCanvas.LayerOperation.SMOOTH_UNION, elementsInLayer: 0, smoothingFactor: 10 },
            { layerOperation: SdfCanvas.LayerOperation.SUBTRACTION, elementsInLayer: 0, smoothingFactor: 0 }
        ];
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
                resolution: this.gl.getUniformLocation(shaderProgram, "uResolution"),
                numElements: this.gl.getUniformLocation(shaderProgram, "uNumElements"),

                layerOperations: this.gl.getUniformLocation(shaderProgram, 'uLayerOperations'),
                elementsInLayer: this.gl.getUniformLocation(shaderProgram, 'uElementsInLayer'),
                smoothingFactors: this.gl.getUniformLocation(shaderProgram, 'uSmoothingFactors'),
                numLayers: this.gl.getUniformLocation(shaderProgram, 'uNumLayers'),

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

        /*         let dpr = window.devicePixelRatio || 1;
                dpr = 1.;
                console.log("aa;", window.devicePixelRatio)
                console.log("bb;", [Math.round(this.canvas.clientWidth * dpr / 2), Math.round(this.canvas.clientHeight * dpr / 2)])
         */        //requestAnimationFrame(() => drawScene(gl, programInfo, buffers));

        window.addEventListener("resize", () => {
            this.resizeCanvasToDisplaySize();
            this.updateUniforms();
            this.draw();
        });

        this.updateLayers();
        this.updateUniforms();
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

    static intToFloatBits(i) {
        const buf = new ArrayBuffer(4);         // buf is just raw memory: 4 bytes; to read/write numbers, you need a view like Uint32Array or Float32Array.
        new Uint32Array(buf)[0] = i >>> 0;      // This creates a typed array view over buf; it does not copy memory; modifying the typed array directly modifies the underlying buffer
        return new Float32Array(buf)[0];        // reinterpret as float
    }

    static parseCSSColor(css) {
        const m = css.match(/rgba?\(([^)]+)\)/);
        if (!m) return { r: 0, g: 0, b: 0, a: 0 };

        const parts = m[1].split(",").map(v => v.trim());

        const r = parseInt(parts[0]);
        const g = parseInt(parts[1]);
        const b = parseInt(parts[2]);
        const a = parts[3] !== undefined ? parseFloat(parts[3]) : 1.0;

        return { r, g, b, a };
    }

    static packRGBA(r, g, b, a = 255) {
        return (
            (r & 0xFF) << 24 |
            (g & 0xFF) << 16 |
            (b & 0xFF) << 8 |
            (a & 0xFF)
        ) >>> 0; // force uint32
    }

    static cssColorToUint32(css) {
        const { r, g, b, a } = SdfCanvas.parseCSSColor(css);
        const A = Math.round(a * 255);
        return SdfCanvas.packRGBA(r, g, b, A);
    }

    updateLayers() {
        let currentIdx = 0;
        let currentNum = 0;

        SdfCanvas.trackedElements.forEach((e) => {
            if (e.dataset.layerIndex == currentIdx) {
                console.log("hallo", currentIdx)
                currentNum++;
            } else {
                this.layers[currentIdx].elementsInLayer = currentNum;

                for (let i = currentIdx + 1; i < e.dataset.layerIndex; i++) {
                    this.layers[i].elementsInLayer = 0;
                }

                currentIdx = e.dataset.layerIndex;
                currentNum = 1;
            }
        });
        this.layers[currentIdx].elementsInLayer = currentNum;

        for (let i = currentIdx + 1; i < this.layers.length; i++) {
            this.layers[i].elementsInLayer = 0;
        }

        this.updateUniforms();
        console.log("sort, layers", this.layers);
    }

    updateUniforms() {
        this.gl.useProgram(this.programInfo.program);

        this.gl.uniform2f(this.programInfo.uniformLocations.resolution, this.canvas.offsetWidth, this.canvas.offsetHeight);
        this.gl.uniform1i(this.programInfo.uniformLocations.numElements, SdfCanvas.trackedElements.length);

        const operations = this.layers.map(l => l.layerOperation);
        const elements = this.layers.map(l => l.elementsInLayer);
        const smoothing = this.layers.map(l => l.smoothingFactor);
        this.gl.uniform1iv(this.programInfo.uniformLocations.layerOperations, operations);
        this.gl.uniform1iv(this.programInfo.uniformLocations.elementsInLayer, elements);
        this.gl.uniform1fv(this.programInfo.uniformLocations.smoothingFactors, smoothing);
        this.gl.uniform1i(this.programInfo.uniformLocations.numLayers, this.layers.length);
    }

    updateUniformBuffers() {
        const resolution = [this.canvas.clientWidth, this.canvas.clienHeight];
        const oneOverX = 1 / resolution[0];

        for (let i = 0; i < SdfCanvas.trackedElements.length; i++) {
            let elementIdx = i * SdfCanvas.VEC4_PER_ELEMENT * 4;
            const element = SdfCanvas.trackedElements[i];

            // Geometry Information
            const rect = element.getBoundingClientRect();
            const computedStyle = getComputedStyle(element);
            const halfWidth = element.offsetWidth * oneOverX * 0.5;
            const halfHeight = element.offsetHeight * oneOverX * 0.5;
            const halfDepth = computedStyle.getPropertyValue("--depth") * 0.5;

            this.geometryBuffer[elementIdx + 0] = rect.left * oneOverX + halfWidth; // x
            this.geometryBuffer[elementIdx + 1] = rect.top * oneOverX + halfHeight; // y
            this.geometryBuffer[elementIdx + 2] = parseFloat(computedStyle.getPropertyValue("--z")) + halfDepth; // z (computedStyleMap has limited availability)
            this.geometryBuffer[elementIdx + 3] = SdfCanvas.intToFloatBits(parseInt(element.dataset.elementType)); // Element id

            switch (parseInt(element.dataset.elementType)) {
                case SdfCanvas.ElementType.SPHERE:
                    break;
                case SdfCanvas.ElementType.BOX:
                    this.geometryBuffer[elementIdx + 4] = halfWidth; // width 
                    this.geometryBuffer[elementIdx + 5] = halfHeight; // height 
                    this.geometryBuffer[elementIdx + 6] = halfDepth; // depth
                    this.geometryBuffer[elementIdx + 7] = 0; // depth
                    break;
                case SdfCanvas.ElementType.ROUND_BOX:
                    break;
            }

            // Shading Information
            this.shadingBuffer[elementIdx + 0] = SdfCanvas.intToFloatBits(SdfCanvas.cssColorToUint32(computedStyle.backgroundColor)); // diffuse color
            this.shadingBuffer[elementIdx + 1] = SdfCanvas.intToFloatBits(SdfCanvas.cssColorToUint32(computedStyle.getPropertyValue("--specular-color"))); // specular color
            this.shadingBuffer[elementIdx + 2] = SdfCanvas.intToFloatBits(SdfCanvas.cssColorToUint32(computedStyle.getPropertyValue("--ambient-color"))); // ambient color
            this.shadingBuffer[elementIdx + 3] = parseFloat(computedStyle.getPropertyValue("--kd")); // diffuse material property

            this.shadingBuffer[elementIdx + 4] = parseFloat(computedStyle.getPropertyValue("--ks")); // specular material property
            this.shadingBuffer[elementIdx + 5] = parseFloat(computedStyle.getPropertyValue("--p")); // specular exponent
            this.shadingBuffer[elementIdx + 6] = parseFloat(computedStyle.getPropertyValue("--ka")); // ambient material property
            this.shadingBuffer[elementIdx + 7] = 1.; // unused for now
        }

        /* const element = SdfCanvas.trackedElements[0];
        const bgc = getComputedStyle(element).backgroundColor;
        const specular = getComputedStyle(element).getPropertyValue("--specular-color");
        const packedS = SdfCanvas.cssColorToUint32(specular);
        console.log(parseFloat(getComputedStyle(element).getPropertyValue("--kd"))); */
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