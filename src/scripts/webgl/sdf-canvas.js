import { initBuffers } from "./init-buffers.js";
import { Matrix } from "../helper/matrix.js";

class SdfLayer {
    constructor(layerOperation = SdfCanvas.LayerOperation.UNION, smoothingFactor = 0) {
        this.layerOperation = layerOperation;
        this.smoothingFactor = smoothingFactor;
        this.elementsInLayer = 0;
    }

    setLayerOperation(layerOperation) {
        this.layerOperation = layerOperation;
    }

    setSmoothingFactor(smoothingFactor) {
        this.smoothingFactor = smoothingFactor;
    }
}

class SdfCanvas {
    static MAX_NUM_COMMANDS = 1024; // maximum number of commands per canvas (in amount of int)
    static MAX_SIZE_ELEMENT_BUFFER = 512; // number of vec4 in the buffer

    static MAX_LAYERS = 16;

    static COMMAND_BLOCK_UNIFORM_BUFFER_BINDING_INDEX = 0;
    static GEOMETRY_BLOCK_UNIFORM_BUFFER_BINDING_INDEX = 1;
    static SHADING_BLOCK_UNIFORM_BUFFER_BINDING_INDEX = 2;

    static GLYPH_TEXTURE_RESOLUTION = 1028; // Resolution along the longer axis
    static NUM_GLYPHS_BUFFERED = 36;
    static GLYPHS_MAX_BOUNDING_BOX = [[-45, -200], [135, 700]]; // box which ALL glyphs fall into in the format [[left, bot], [right, top]]
    static GLYPHS_PADDING = 200; // padding that is applied to all sides of the max bounding box

    static computeGlyphTextureResolution() {
        const rangeX = this.GLYPHS_MAX_BOUNDING_BOX[1][0] - this.GLYPHS_MAX_BOUNDING_BOX[0][0];
        const rangeY = this.GLYPHS_MAX_BOUNDING_BOX[1][1] - this.GLYPHS_MAX_BOUNDING_BOX[0][1];

        if (rangeY > rangeX) {
            return {
                resolutionX: this.GLYPH_TEXTURE_RESOLUTION * (rangeY / rangeX),
                resolutionY: this.GLYPH_TEXTURE_RESOLUTION,
            }
        }
        return {
            resolutionX: this.GLYPH_TEXTURE_RESOLUTION,
            resolutionY: this.GLYPH_TEXTURE_RESOLUTION * (rangeX / rangeY),
        }
    }

    static Commands = Object.freeze({
        // Elements
        SPHERE: 0,
        BOX_SIMPLE: 1,
        BOX: 2,
        ROUND_BOX: 3,
        TEXT: 4,

        // Layer Operations
        SET_LAYER_SMOOTHNESS: 100,
        UNION: 101,
        SUBTRACTION: 102,
        INTERSECTION: 103,
        XOR: 104,
        SMOOTH_UNION: 105,
        SMOOTH_SUBTRACTION: 106,
        SMOOTH_INTERSECTION: 107,
    })

    static ElementType = Object.freeze({
        SPHERE: 0,
        BOX_SIMPLE: 1,
        BOX: 2,
        ROUND_BOX: 3,
        TEXT: 4,
        BORDER: 30,
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
    static trackedElementsSize = 0;

    static getElementSize(element) { // in amounts of vec4s
        switch (element.getElementType()) {
            case SdfCanvas.ElementType.SPHERE:
                return 4;
            case SdfCanvas.ElementType.BOX_SIMPLE:
                return 4;
            case SdfCanvas.ElementType.BOX:
                return 6;
            case SdfCanvas.ElementType.ROUND_BOX:
                return 5;
            case SdfCanvas.ElementType.TEXT: // variable length
                return element.getSize();
        }
    }

    static addTrackedElement(element) {
        const size = this.getElementSize(element);

        this.trackedElements.push(element);
        this.trackedElements.sort((a, b) => (a.dataset.layerIndex - b.dataset.layerIndex));
        this.trackedElementsSize += size;

        this.instantiatedCanvases.forEach((c) => {
            c.updateLayers();
        });
    }

    static removeTrackedElement(element) {
        const size = this.getElementSize(element);

        const index = this.trackedElements.indexOf(element);
        if (index <= -1) {
            return;
        }
        this.trackedElements.splice(index, 1);
        this.trackedElementsSize -= size;

        this.instantiatedCanvases.forEach((c) => {
            c.updateLayers();
        })
    }

    static updateTrackedElementSize(oldSize, newSize) {
        // This method is only important for elements with variable size (e.g. TEXT)
        this.trackedElementsSize -= oldSize;
        this.trackedElementsSize += newSize;
        return newSize;
    }

    static sortTrackedElements() {
        this.trackedElements.sort((a, b) => (a.dataset.layerIndex - b.dataset.layerIndex));

        this.instantiatedCanvases.forEach((c) => {
            c.updateLayers();
        });
    }

    static getCharIndex(char) {
        // The dot is handled differently
        if (char == ".") {
            return this.NUM_GLYPHS_BUFFERED + 1;
        }

        // The letters are ordered in this format: a-z;0-9;
        const charCode = char.charCodeAt(0);
        const startLowerCase = 97; // 'a'.charCodeAt(0);
        const endLowerCase = 122; // 'z'.charCodeAt(0);
        const startNumbers = 48; // '0'.charCodeAt(0);
        const endNumbers = 57; // '9'.charCodeAt(0);

        if (startLowerCase <= charCode && charCode <= endLowerCase) {
            return charCode - startLowerCase;
        }
        if (startNumbers <= charCode && charCode <= endNumbers) {
            return charCode - startNumbers + (endLowerCase - startLowerCase + 1);
        }
        return this.NUM_GLYPHS_BUFFERED;
    }

    constructor(canvasName, renderLayers = [0]) {
        SdfCanvas.instantiatedCanvases.push(this);

        this.canvasName = canvasName;
        this.renderLayers = renderLayers;
        this.ready = false;
        this.downscaleFactorX = 1;
        this.downscaleFactorY = 1;

        this.cameraZ = 10;
        this.twoDMode = false;

        this.canvas;
        this.gl;
        this.programInfo;
        this.buffers;
        this.geometryBuffer = new Float32Array(SdfCanvas.MAX_SIZE_ELEMENT_BUFFER * 4);
        this.shadingBuffer = new Float32Array(SdfCanvas.MAX_SIZE_ELEMENT_BUFFER * 4);

        let layer0 = new SdfLayer(SdfCanvas.LayerOperation.UNION, 0);
        let layer1 = new SdfLayer(SdfCanvas.LayerOperation.SMOOTH_UNION, 30);
        let layer2 = new SdfLayer(SdfCanvas.LayerOperation.SMOOTH_UNION, 30);
        this.layers = [layer0, layer1, layer2];
    }

    async initWebgl() {
        this.canvas = document.getElementById(this.canvasName);

        // Initialize the GL context
        this.gl = this.canvas.getContext("webgl2");

        // Only continue if WebGL is available and working
        if (this.gl === null) {
            alert(
                "Unable to initialize WebGL. Your browser or machine may not support it.",
            );
            return;
        }

        // Bake the Letter Sdfs
        this.gl.getExtension('EXT_color_buffer_float');
        this.gl.getExtension('OES_texture_float_linear');
        await this.bakeLetterSdfs();

        this.resizeCanvasToDisplaySize();

        // Set clear color to black, fully opaque
        this.gl.clearColor(0.0, 0.0, 0.0, 1.0);
        // Clear the color buffer with specified clear color
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);

        const { vertexSource, fragmentSource } = await SdfCanvas.loadShadersFromDisk("vertex.glsl", "fragment.glsl");

        // Initialize a shader program; this is where all the lighting
        // for the vertices and so forth is established.
        const startTime = performance.now()

        const shaderProgram = await this.initShaderProgram(vertexSource, fragmentSource);

        const endTime = performance.now()
        console.log(`Call to doSomething took ${endTime - startTime} milliseconds`)


        console.log("after initShaderProgram")
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

                top: this.gl.getUniformLocation(shaderProgram, "uTopOffset"),
                left: this.gl.getUniformLocation(shaderProgram, "uLeftOffset"),
                width: this.gl.getUniformLocation(shaderProgram, "uWindowWidth"),
                height: this.gl.getUniformLocation(shaderProgram, "uWindowHeight"),

                cameraZ: this.gl.getUniformLocation(shaderProgram, "uCameraZ"),
                twoDMode: this.gl.getUniformLocation(shaderProgram, "uTwoDMode"),

                numCommands: this.gl.getUniformLocation(shaderProgram, "uNumCommands"),
                layerOperations: this.gl.getUniformLocation(shaderProgram, 'uLayerOperations'),
                elementsInLayer: this.gl.getUniformLocation(shaderProgram, 'uElementsInLayer'),
                smoothingFactors: this.gl.getUniformLocation(shaderProgram, 'uSmoothingFactors'),
                numLayers: this.gl.getUniformLocation(shaderProgram, 'uNumLayers'),

                // Uniforms for the Glyph Texture
                sdfArray: this.gl.getUniformLocation(shaderProgram, 'uSdfArray'),
                boxMin: this.gl.getUniformLocation(shaderProgram, "uBoxMin"),
                boxMax: this.gl.getUniformLocation(shaderProgram, "uBoxMax"),

                commandBlock: this.gl.getUniformBlockIndex(shaderProgram, "CommandBlock"),
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

        window.addEventListener("resize", () => {
            this.resizeCanvasToDisplaySize();
            this.updateSmoothingFactors();
            this.updateUniforms();
            this.draw();
        });

        this.updateLayers();
        this.updateUniforms();
        this.ready = true;
    }

    async bakeLetterSdfs() {
        const gl = this.gl;

        this.sdfTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.sdfTexture);

        // Allocate the 3d storage: texStorage3D(target, mip-levels, internalformat, width, height, depth)
        const { resolutionX, resolutionY } = SdfCanvas.computeGlyphTextureResolution();
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R32F, resolutionX, resolutionY, SdfCanvas.NUM_GLYPHS_BUFFERED + 1);

        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR); // Texture minification filter
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR); // Texture magnification filter
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); // Wrapping function for texture coordinate s
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); // Wrapping function for texture coordinate t

        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

        const { vertexSource, fragmentSource } = await SdfCanvas.loadShadersFromDisk("letterBakingVertex.glsl", "letterBakingFragment.glsl");
        const bakeProg = await this.initShaderProgram(vertexSource, fragmentSource);

        gl.useProgram(bakeProg);
        const boxMinLoc = gl.getUniformLocation(bakeProg, "uBoxMin");
        const boxMaxLoc = gl.getUniformLocation(bakeProg, "uBoxMax");
        const charIndexLoc = gl.getUniformLocation(bakeProg, "uCharIndex");

        const quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

        const posAttr = gl.getAttribLocation(bakeProg, "aPosition");
        gl.enableVertexAttribArray(posAttr);
        gl.vertexAttribPointer(posAttr, 2, gl.FLOAT, false, 0, 0);

        gl.viewport(0, 0, resolutionX, resolutionY);
        gl.uniform2f(boxMinLoc, SdfCanvas.GLYPHS_MAX_BOUNDING_BOX[0][0] - SdfCanvas.GLYPHS_PADDING, SdfCanvas.GLYPHS_MAX_BOUNDING_BOX[0][1] - SdfCanvas.GLYPHS_PADDING);
        gl.uniform2f(boxMaxLoc, SdfCanvas.GLYPHS_MAX_BOUNDING_BOX[1][0] + SdfCanvas.GLYPHS_PADDING, SdfCanvas.GLYPHS_MAX_BOUNDING_BOX[1][1] + SdfCanvas.GLYPHS_PADDING);

        // Render EACH layer individually
        for (let i = 0; i <= SdfCanvas.NUM_GLYPHS_BUFFERED; i++) {
            // framebufferTextureLayer(target, attachment, texture, level, layer) attaches a single layer of a texture to a framebuffer
            gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.sdfTexture, 0, i);

            // Tell the shader which character to compute
            gl.uniform1i(charIndexLoc, i);

            // drawArrays(mode, first (starting index), count (num of vertices))
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteBuffer(quadBuffer);
        gl.deleteProgram(bakeProg);
        gl.deleteFramebuffer(fbo);
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

        // Bind the baked SDF array to texture unit 0
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, this.sdfTexture);

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
            const elementRenderLayers = e.dataset.renderLayers.split(" ").map((s) => parseInt(s));
            if (!this.containedInRenderLayers(elementRenderLayers)) {
                return;
            }
            if (parseInt(e.dataset.layerIndex) == currentIdx) {
                currentNum++;
            } else {
                this.layers[currentIdx].elementsInLayer = currentNum;

                // console.log(e.dataset.layerIndex)
                for (let i = currentIdx + 1; i < parseInt(e.dataset.layerIndex); i++) {
                    this.layers[i].elementsInLayer = 0;
                }

                currentIdx = parseInt(e.dataset.layerIndex);
                currentNum = 1;
            }
        });
        this.layers[currentIdx].elementsInLayer = currentNum;

        for (let i = currentIdx + 1; i < this.layers.length; i++) {
            this.layers[i].elementsInLayer = 0;
        }

        this.gl.useProgram(this.programInfo.program);

        const operations = this.layers.map(l => l.layerOperation);
        const elements = this.layers.map(l => l.elementsInLayer);
        const smoothing = this.layers.map(l => l.smoothingFactor / window.innerWidth);
        this.gl.uniform1iv(this.programInfo.uniformLocations.layerOperations, operations);
        this.gl.uniform1iv(this.programInfo.uniformLocations.elementsInLayer, elements);
        this.gl.uniform1fv(this.programInfo.uniformLocations.smoothingFactors, smoothing);
        this.gl.uniform1i(this.programInfo.uniformLocations.numLayers, this.layers.length);
    }

    updateSmoothingFactors() {
        this.gl.useProgram(this.programInfo.program);
        const smoothing = this.layers.map(l => l.smoothingFactor / window.innerWidth);
        this.gl.uniform1fv(this.programInfo.uniformLocations.smoothingFactors, smoothing);
    }

    updateUniforms() {
        this.gl.useProgram(this.programInfo.program);

        // Tells the uSdfArray uniform to look at gl.TEXTURE0
        this.gl.uniform1i(this.programInfo.uniformLocations.sdfArray, 0);
        this.gl.uniform2f(this.programInfo.uniformLocations.boxMin, SdfCanvas.GLYPHS_MAX_BOUNDING_BOX[0][0] - SdfCanvas.GLYPHS_PADDING, SdfCanvas.GLYPHS_MAX_BOUNDING_BOX[0][1] - SdfCanvas.GLYPHS_PADDING);
        this.gl.uniform2f(this.programInfo.uniformLocations.boxMax, SdfCanvas.GLYPHS_MAX_BOUNDING_BOX[1][0] + SdfCanvas.GLYPHS_PADDING, SdfCanvas.GLYPHS_MAX_BOUNDING_BOX[1][1] + SdfCanvas.GLYPHS_PADDING);

        this.gl.uniform2f(this.programInfo.uniformLocations.resolution, window.innerWidth, window.innerHeight);

        const rect = this.canvas.getBoundingClientRect();
        this.gl.uniform1f(this.programInfo.uniformLocations.top, rect.top / window.innerWidth);
        this.gl.uniform1f(this.programInfo.uniformLocations.left, rect.left / window.innerWidth);
        this.gl.uniform1f(this.programInfo.uniformLocations.width, (rect.right - rect.left) / window.innerWidth);
        this.gl.uniform1f(this.programInfo.uniformLocations.height, (rect.bottom - rect.top) / window.innerWidth);

        this.gl.uniform1f(this.programInfo.uniformLocations.cameraZ, this.cameraZ);
        this.gl.uniform1i(this.programInfo.uniformLocations.twoDMode, this.twoDMode);
    }

    updateUniformBuffers() {
        this.updateUniforms();

        const oneOverX = 1 / window.innerWidth;
        const unpaddedHeight = SdfCanvas.GLYPHS_MAX_BOUNDING_BOX[1][1] - SdfCanvas.GLYPHS_MAX_BOUNDING_BOX[0][1];
        const unpaddedWidth = SdfCanvas.GLYPHS_MAX_BOUNDING_BOX[1][0] - SdfCanvas.GLYPHS_MAX_BOUNDING_BOX[0][0];
        const paddedWidth = unpaddedWidth + (SdfCanvas.GLYPHS_PADDING * 2);

        let elementIdx = 0;
        for (let i = 0; i < SdfCanvas.trackedElements.length; i++) {
            const element = SdfCanvas.trackedElements[i];

            // check if we even want to render that element
            const elementRenderLayers = element.dataset.renderLayers.split(" ").map((s) => parseInt(s));
            if (!this.containedInRenderLayers(elementRenderLayers)) {
                continue;
            }

            const elementType = element.getElementType();
            const isText = elementType == SdfCanvas.ElementType.TEXT;

            // don't inlcude empty strings
            if (isText && element.getNumberOfLetters() <= 0) {
                element.updateSize();
                this.geometryBuffer[elementIdx + 12] = SdfCanvas.intToFloatBits(elementType); // Element id
                this.geometryBuffer[elementIdx + 13] = SdfCanvas.intToFloatBits(0); // amount of letters
                elementIdx += SdfCanvas.getElementSize(element) * 4;
                continue;
            }

            const rects = isText ? element.getWordRects() : null;
            const rect = element.getBoundingClientRect();

            const computedStyle = getComputedStyle(element);
            let mat = Matrix.parseMatrix(computedStyle.transform);

            const halfWidth = isText ? element.measure(rects[0][0]) * oneOverX * 0.5 : element.offsetWidth * oneOverX * 0.5;
            const halfHeight = isText ? element.measureHeight(rects[0][0]) * oneOverX * 0.5 : element.offsetHeight * oneOverX * 0.5; //parseInt(computedStyle.getPropertyValue("font-size")) * oneOverX * 0.5 
            const halfDepth = this.twoDMode ? 100 : parseFloat(computedStyle.getPropertyValue("--depth")) * oneOverX * 0.5;

            const offsetX = (rect.left + rect.width * 0.5) * oneOverX;
            const offsetY = (rect.top + rect.height * 0.5) * oneOverX;
            const offsetZ = this.twoDMode ? 0 : parseFloat(computedStyle.getPropertyValue("--z")) * oneOverX;

            // calculate computedStyle.transform @ T(offsetX, offsetY, offsetZ)
            mat[12] = offsetX; // + mat[12] * oneOverX;
            mat[13] = offsetY; // + mat[13] * oneOverX;
            mat[14] = offsetZ + mat[14] * oneOverX; // for tx and ty this is covered by the boundingClientRect
            mat[15] = 1;

            const originalTz = mat[14];

            // if I want the surface to be the top surface
            /* mat[12] -= mat[8] * halfDepth;
            mat[13] -= mat[9] * halfDepth;
            mat[14] -= mat[10] * halfDepth; */

            // invert the matrix
            Matrix.invertAffineMat4InPlace(mat);

            // Inverse affine modelview matrix = computedStyle.transform @ T(offsetX, offsetY, offsetZ), computedStyle.transform used without translation since that is already in boundingclientrect
            this.geometryBuffer[elementIdx + 0] = mat[0]; // column 1 [mat[0], mat[1], mat[2], 0]^T
            this.geometryBuffer[elementIdx + 1] = mat[1];
            this.geometryBuffer[elementIdx + 2] = mat[2];

            this.geometryBuffer[elementIdx + 3] = mat[4]; // column 2 [mat[4], mat[5], mat[6], 0]^T
            this.geometryBuffer[elementIdx + 4] = mat[5];
            this.geometryBuffer[elementIdx + 5] = mat[6];

            this.geometryBuffer[elementIdx + 6] = mat[8]; // column 3 [mat[8], mat[9], mat[10], 0]^T
            this.geometryBuffer[elementIdx + 7] = mat[9];
            this.geometryBuffer[elementIdx + 8] = mat[10];

            this.geometryBuffer[elementIdx + 9] = mat[12]; // tx, column 4 [tx, ty, tz, 1]^T
            this.geometryBuffer[elementIdx + 10] = mat[13]; // ty
            this.geometryBuffer[elementIdx + 11] = mat[14]; // tz

            // Element Properties
            this.geometryBuffer[elementIdx + 12] = SdfCanvas.intToFloatBits(elementType); // Element id

            switch (elementType) {
                case SdfCanvas.ElementType.SPHERE:
                    this.geometryBuffer[elementIdx + 13] = parseFloat(computedStyle.getPropertyValue("--r")) * oneOverX * 0.5; // radius 
                    break;
                case SdfCanvas.ElementType.BOX_SIMPLE:
                    this.geometryBuffer[elementIdx + 13] = halfWidth; // width 
                    this.geometryBuffer[elementIdx + 14] = halfHeight; // height 
                    this.geometryBuffer[elementIdx + 15] = halfDepth; // depth
                    break;
                case SdfCanvas.ElementType.BOX:
                    this.geometryBuffer[elementIdx + 13] = halfWidth; // width 
                    this.geometryBuffer[elementIdx + 14] = halfHeight; // height 
                    this.geometryBuffer[elementIdx + 15] = halfDepth; // depth

                    this.geometryBuffer[elementIdx + 16] = parseFloat(computedStyle.borderBottomRightRadius) * oneOverX;
                    this.geometryBuffer[elementIdx + 17] = parseFloat(computedStyle.borderTopRightRadius) * oneOverX;
                    this.geometryBuffer[elementIdx + 18] = parseFloat(computedStyle.borderBottomLeftRadius) * oneOverX;
                    this.geometryBuffer[elementIdx + 19] = parseFloat(computedStyle.borderTopLeftRadius) * oneOverX;

                    this.geometryBuffer[elementIdx + 20] = SdfCanvas.intToFloatBits(parseInt(computedStyle.getPropertyValue("--border-radius-type"))); // border radius
                    this.geometryBuffer[elementIdx + 21] = SdfCanvas.intToFloatBits(parseInt(computedStyle.getPropertyValue("--rotation-offset"))); // initial rotation
                    this.geometryBuffer[elementIdx + 22] = 0;
                    break;
                case SdfCanvas.ElementType.ROUND_BOX:
                    this.geometryBuffer[elementIdx + 13] = halfWidth; // width 
                    this.geometryBuffer[elementIdx + 14] = halfHeight; // height 
                    this.geometryBuffer[elementIdx + 15] = halfDepth; // depth

                    this.geometryBuffer[elementIdx + 16] = parseFloat(computedStyle.getPropertyValue("--r")) * oneOverX * 0.5; // border radius
                    break;
                case SdfCanvas.ElementType.TEXT:
                    // The text expects an array of letters where the x,y,z position is at the same place as the origin of the letters in "glyph-space"
                    // The scale is how big the texture is in world space (including padding), send inverse scale so that we can multiply by it to get to glyph-space 
                    element.updateSize();
                    const numLetters = element.getNumberOfLetters();
                    const glpyhSpaceScale = (2 * halfHeight) / unpaddedHeight; // how much one unit of "glyph-space" is in world-space 
                    this.geometryBuffer[elementIdx + 13] = SdfCanvas.intToFloatBits(numLetters); // amount of letters
                    this.geometryBuffer[elementIdx + 14] = 1 / (paddedWidth * glpyhSpaceScale); // inverse letter scale 
                    this.geometryBuffer[elementIdx + 15] = halfDepth; // depth 

                    this.geometryBuffer[elementIdx + 16] = Math.max(parseFloat(computedStyle.getPropertyValue("--letterSmoothness")) * oneOverX, 0.0001); // smoothness between letters
                    // this.geometryBuffer[elementIdx + 17] = 0; // unused (maybe later for font, e.g.) 
                    // this.geometryBuffer[elementIdx + 18] = 0; // unused 
                    // this.geometryBuffer[elementIdx + 19] = 0; // unused 

                    let inverseMat3 = Matrix.extractMat3FromMat4(mat);
                    let wordCenterLocal = new Float32Array(3);

                    let letterIdx = 0;
                    outerLoop:
                    for (let wordIdx = 0; wordIdx < rects.length; wordIdx++) {
                        const currentWord = rects[wordIdx];
                        const currentText = currentWord[0];
                        const currentRect = currentWord[1];

                        // Get the screen/world space X and Y for the word's center
                        const currentOffsetX = (currentRect.left + currentRect.width * 0.5) * oneOverX;
                        const currentOffsetY = (currentRect.top + currentRect.height * 0.5) * oneOverX;

                        const offsetX = (rect.left + rect.width * 0.5) * oneOverX;
                        const offsetY = (rect.top + rect.height * 0.5) * oneOverX;

                        // Solve for the exact World Z-depth of this specific word
                        let offsetZ = originalTz; // Fallback in case the element is viewed perfectly edge-on
                        const dx = currentOffsetX - offsetX;
                        const dy = currentOffsetY - offsetY;

                        if (Math.abs(mat[10]) > 1e-6) {
                            offsetZ = originalTz + (-(inverseMat3[2] * dx + inverseMat3[5] * dy)) / inverseMat3[8];
                        }

                        // center the current word in world space and transform them into local space
                        wordCenterLocal[0] = currentOffsetX;
                        wordCenterLocal[1] = currentOffsetY;
                        wordCenterLocal[2] = offsetZ;
                        Matrix.mat3TimesVec3InPlace(inverseMat3, wordCenterLocal);

                        // In local space, the word is unrotated and its own center is at (0,0).
                        const wordLeftEdgeLocalX = -element.measure(currentText) * 0.5 * oneOverX; // currentHalfWidth

                        for (let currentLetterIdx = 0; currentLetterIdx < currentWord[0].length; currentLetterIdx++) {
                            let currentSubstringWidth = element.measure(currentText.substring(0, currentLetterIdx)) * oneOverX;
                            const currentLetter = currentText.charAt(currentLetterIdx);
                            if (currentLetter == "t") {
                                currentSubstringWidth += 22.5 * glpyhSpaceScale;// * oneOverX;
                            }

                            this.geometryBuffer[elementIdx + 20 + letterIdx * 4 + 0] = -wordCenterLocal[0] - (wordLeftEdgeLocalX + currentSubstringWidth); // offsetX
                            this.geometryBuffer[elementIdx + 20 + letterIdx * 4 + 1] = -wordCenterLocal[1] - halfHeight + SdfCanvas.GLYPHS_PADDING * glpyhSpaceScale; // offsetY
                            this.geometryBuffer[elementIdx + 20 + letterIdx * 4 + 2] = -wordCenterLocal[2]; // offsetZ
                            this.geometryBuffer[elementIdx + 20 + letterIdx * 4 + 3] = SdfCanvas.intToFloatBits(SdfCanvas.getCharIndex(currentLetter)); // letterCode
                            letterIdx++;
                            if (letterIdx >= numLetters) {
                                break outerLoop;
                            }
                        }
                    }
                    break;
            }

            // Shading Information
            this.shadingBuffer[elementIdx + 0] = SdfCanvas.intToFloatBits(SdfCanvas.cssColorToUint32(computedStyle.getPropertyValue("--diffuse-color"))); // diffuse color
            this.shadingBuffer[elementIdx + 1] = SdfCanvas.intToFloatBits(SdfCanvas.cssColorToUint32(computedStyle.getPropertyValue("--specular-color"))); // specular color
            this.shadingBuffer[elementIdx + 2] = SdfCanvas.intToFloatBits(SdfCanvas.cssColorToUint32(computedStyle.getPropertyValue("--ambient-color"))); // ambient color
            this.shadingBuffer[elementIdx + 3] = parseFloat(computedStyle.getPropertyValue("--kd")); // diffuse material property

            this.shadingBuffer[elementIdx + 4] = parseFloat(computedStyle.getPropertyValue("--ks")); // specular material property
            this.shadingBuffer[elementIdx + 5] = parseFloat(computedStyle.getPropertyValue("--p")); // specular exponent
            this.shadingBuffer[elementIdx + 6] = parseFloat(computedStyle.getPropertyValue("--ka")); // ambient material property
            this.shadingBuffer[elementIdx + 7] = 1.; // unused for now

            elementIdx += SdfCanvas.getElementSize(element) * 4;
        }
    }

    resizeCanvasToDisplaySize() {
        // 1. Get the pixel density of the screen (e.g., Retina screens are often 2)
        const dpr = window.devicePixelRatio || 1;

        // 2. Calculate the actual physical pixels of the display area
        const displayWidth = this.canvas.clientWidth * dpr;
        const displayHeight = this.canvas.clientHeight * dpr;

        // 3. Apply your downscale factor to determine the WebGL rendering resolution
        // (Math.max is used to prevent the canvas from ever being 0x0 pixels)
        const renderWidth = Math.max(1, Math.round(displayWidth / this.downscaleFactorX));
        const renderHeight = Math.max(1, Math.round(displayHeight / this.downscaleFactorY));

        // 4. If the rendering resolution changed, update the canvas and viewport
        if (this.canvas.width !== renderWidth || this.canvas.height !== renderHeight) {

            // This changes the internal rendering resolution (the WebGL buffer size)
            this.canvas.width = renderWidth;
            this.canvas.height = renderHeight;

            // The WebGL viewport MUST match the internal buffer size, 
            this.gl.viewport(0, 0, renderWidth, renderHeight);
        }
    }

    initShaderProgram(vsSource, fsSource) {
        return new Promise((resolve, reject) => {
            const vertexShader = this.loadShader(this.gl.VERTEX_SHADER, vsSource);
            const fragmentShader = this.loadShader(this.gl.FRAGMENT_SHADER, fsSource);

            // Create the shader program
            const shaderProgram = this.gl.createProgram(); // program of vertex + fragment shader
            this.gl.attachShader(shaderProgram, vertexShader);
            this.gl.attachShader(shaderProgram, fragmentShader);
            this.gl.linkProgram(shaderProgram);

            // Try to get the parallel compilation extension
            const ext = this.gl.getExtension("KHR_parallel_shader_compile");

            const checkCompletion = () => {
                if (ext) {
                    // If extension exists, check if compilation is done in the background
                    if (this.gl.getProgramParameter(shaderProgram, ext.COMPLETION_STATUS_KHR)) {
                        // Check program link status; if OK, use it.
                        this.finalizeProgram(shaderProgram, vertexShader, fragmentShader, resolve, reject);
                    } else {
                        // Not done yet, check again next frame!
                        requestAnimationFrame(checkCompletion);
                    }
                } else {
                    // Program linking is synchronous.
                    // We yielded for at least one frame so the UI could paint. Now we force the check.
                    this.finalizeProgram(shaderProgram, vertexShader, fragmentShader, resolve, reject);
                }
            };

            // Start the polling loop on the next frame
            requestAnimationFrame(checkCompletion);
        });
    }

    finalizeProgram(shaderProgram, vertexShader, fragmentShader, resolve, reject) {
        if (!this.gl.getProgramParameter(shaderProgram, this.gl.LINK_STATUS)) {
            console.error("Shader program failed to link: ", this.gl.getProgramInfoLog(shaderProgram));
            console.error("Vertex log: ", this.gl.getShaderInfoLog(vertexShader));
            console.error("Fragment log: ", this.gl.getShaderInfoLog(fragmentShader));
            alert("Unable to initialize the shader program.");
            reject(new Error("Shader initialization failed"));
            return;
        }
        resolve(shaderProgram);
    }

    loadShader(type, source) {
        const shader = this.gl.createShader(type); // either vertex or fragment

        // Send the source to the shader object
        this.gl.shaderSource(shader, source);

        // Compile the shader program (This now happens in the background!)
        this.gl.compileShader(shader);

        // REMOVED: gl.getShaderParameter(shader, gl.COMPILE_STATUS)
        // Querying the status here would force the browser to freeze.
        return shader;
    }

    containedInRenderLayers(arr) {
        return this.renderLayers.some(item => arr.includes(item));
    }

    static async loadShadersFromDisk(vertexName, fragmentName) {
        const responseVertex = await fetch("./src/shaders/" + vertexName);
        const responseFragment = await fetch("./src/shaders/" + fragmentName);

        return {
            vertexSource: await responseVertex.text(),
            fragmentSource: await responseFragment.text(),
        };
    }
}

export { SdfCanvas }