import { loadShadersFromDisk, initShaderProgram, initBuffers, injectGLSL } from "./webgl-helper-functions.js";
import { Matrix } from "../helper/matrix.js";
import { SdfCommands } from "./sdf-commands.js";
import { SdfLayer } from "../sdf-layer.js";
import { Twist } from "../modifiers.js";

class SdfCanvas {
    // ╔══════════════════════════════════════════════════════════╗
    // ║                       Constants                          ║
    // ╚══════════════════════════════════════════════════════════╝
    static MAX_NUM_COMMANDS = 1024; // maximum number of commands per canvas (in amount of int)
    static MAX_SIZE_ELEMENT_BUFFER = 512; // number of vec4 in the buffer

    static MAX_LAYERS = 16;

    static COMMAND_BLOCK_UNIFORM_BUFFER_BINDING_INDEX = 0;
    static GEOMETRY_BLOCK_UNIFORM_BUFFER_BINDING_INDEX = 1;
    static SHADING_BLOCK_UNIFORM_BUFFER_BINDING_INDEX = 2;

    // ╔══════════════════════════════════════════════════════════╗
    // ║                      Glyphs Texture                      ║
    // ╚══════════════════════════════════════════════════════════╝
    static GLYPH_TEXTURE_RESOLUTION = 1028; // Resolution along the longer axis
    static NUM_GLYPHS_BUFFERED = 36;
    static GLYPHS_MAX_BOUNDING_BOX = [[-45, -200], [135, 700]]; // box which ALL glyphs fall into in the format [[left, bot], [right, top]]
    static GLYPHS_PADDING = 200; // padding that is applied to all sides of the max bounding box
    static bakedGlyphsTexture = false;
    static glyphsTexture; // holds the gl.TEXTURE_2D_ARRAY of the sdf for the letters

    static #computeGlyphTextureResolution() {
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

    static async #bakeLetterSdfs(gl) {
        this.glyphsTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.glyphsTexture);

        // Allocate the 3d storage: texStorage3D(target, mip-levels, internalformat, width, height, depth)
        const { resolutionX, resolutionY } = SdfCanvas.#computeGlyphTextureResolution();
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R32F, resolutionX, resolutionY, SdfCanvas.NUM_GLYPHS_BUFFERED + 1);

        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR); // Texture minification filter
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR); // Texture magnification filter
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); // Wrapping function for texture coordinate s
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); // Wrapping function for texture coordinate t

        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

        const { vertexSource, fragmentSource } = await loadShadersFromDisk("letterBakingVertex.glsl", "letterBakingFragment.glsl");
        const bakeProg = await initShaderProgram(gl, vertexSource, fragmentSource);

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
            gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.glyphsTexture, 0, i);

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

    // ╔══════════════════════════════════════════════════════════╗
    // ║             Static Properties and Methods                ║
    // ╚══════════════════════════════════════════════════════════╝
    static #instantiatedCanvases = [];

    static #trackedElements = [];
    static #layers = [
        new SdfLayer(SdfCommands.UNION, 0),
        new SdfLayer(SdfCommands.SMOOTH_UNION, 30),
        new SdfLayer(SdfCommands.SMOOTH_UNION, 30, SdfCommands.LAYER_TWIST)
    ]

    static get layers() {
        return this.#layers;
    }

    static addTrackedElement(element) {
        this.#trackedElements.push(element);
        this.#trackedElements.sort((a, b) => (a.dataset.layerIndex - b.dataset.layerIndex));
        this.#updateLayers();
    }

    static removeTrackedElement(element) {
        const index = this.#trackedElements.indexOf(element);
        if (index <= -1) {
            return;
        }
        this.#trackedElements.splice(index, 1);
        this.#updateLayers();
    }

    static sortTrackedElements() {
        this.#trackedElements.sort((a, b) => (a.dataset.layerIndex - b.dataset.layerIndex));
        this.#updateLayers();
    }

    static #getElementSize(element) { // in amounts of vec4s
        switch (element.getElementType()) {
            case SdfCommands.SPHERE:
                return 1;
            case SdfCommands.BOX_SIMPLE:
                return 1;
            case SdfCommands.BOX:
                return 3;
            case SdfCommands.TEXT: // variable length
                return element.size;
        }
    }

    static #updateLayers() {
        let currentIdx = 0;
        let currentNum = 0;

        this.#trackedElements.forEach((e) => {
            if (parseInt(e.dataset.layerIndex) == currentIdx) {
                currentNum++;
            } else {
                this.#layers[currentIdx].elementsInLayer = currentNum;

                // console.log(e.dataset.layerIndex)
                for (let i = currentIdx + 1; i < parseInt(e.dataset.layerIndex); i++) {
                    this.#layers[i].elementsInLayer = 0;
                }

                currentIdx = parseInt(e.dataset.layerIndex);
                currentNum = 1;
            }
        });
        this.#layers[currentIdx].elementsInLayer = currentNum;

        for (let i = currentIdx + 1; i < this.#layers.length; i++) {
            this.#layers[i].elementsInLayer = 0;
        }
    }

    static #getCharIndex(char) {
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

    static #intToFloatBits(i) {
        const buf = new ArrayBuffer(4);    // buf is just raw memory: 4 bytes; to read/write numbers, you need a view like Uint32Array or Float32Array.
        new Uint32Array(buf)[0] = i >>> 0; // This creates a typed array view over buf; it does not copy memory; modifying the typed array directly modifies the underlying buffer
        return new Float32Array(buf)[0];   // reinterpret as float
    }

    static #parseCSSColor(css) {
        const m = css.match(/rgba?\(([^)]+)\)/);
        if (!m) return { r: 0, g: 0, b: 0, a: 0 };

        const parts = m[1].split(",").map(v => v.trim());

        const r = parseInt(parts[0]);
        const g = parseInt(parts[1]);
        const b = parseInt(parts[2]);
        const a = parts[3] !== undefined ? parseFloat(parts[3]) : 1.0;

        return { r, g, b, a };
    }

    static #packRGBA(r, g, b, a = 255) {
        return (
            (r & 0xFF) << 24 |
            (g & 0xFF) << 16 |
            (b & 0xFF) << 8 |
            (a & 0xFF)
        ) >>> 0; // force uint32
    }

    static #cssColorToUint32(css) {
        const { r, g, b, a } = SdfCanvas.#parseCSSColor(css);
        const A = Math.round(a * 255);
        return SdfCanvas.#packRGBA(r, g, b, A);
    }

    // ╔══════════════════════════════════════════════════════════╗
    // ║                        SdfCanvas                         ║
    // ╚══════════════════════════════════════════════════════════╝
    // Public members
    renderLayers;
    #ready; // no setter
    downscaleFactorX;
    downscaleFactorY;

    cameraZ;
    useAA;
    twoDMode;
    useCustomShadeFunction;
    customShadeFunction;
    overwriteLayers;

    // Private Properties
    #canvasName;
    #canvas;
    #gl;
    #programInfo;
    #buffers;
    #numCommands;
    #commandBuffer;
    #geometryBuffer;
    #shadingBuffer;

    // Getters and Setters
    get ready() {
        return this.#ready;
    }

    constructor(canvasName, renderLayers = [0]) {
        SdfCanvas.#instantiatedCanvases.push(this);

        this.#canvasName = canvasName;
        this.renderLayers = renderLayers;
        this.#ready = false;
        this.downscaleFactorX = 2;
        this.downscaleFactorY = 2;

        this.cameraZ = 10;
        this.useAA = false;
        this.twoDMode = false;
        this.useCustomShadeFunction = false;
        this.customShadeFunction = ` 
        vec3 shade(Surface surface) {
            float sdfValue = surface.distance * 80.0f;
            
            if (sdfValue < 0.0f){
                return surface.colorDiffuse;
            }
            
            ColorStop[] colors = ColorStop[](
            //ColorStop(surface.colorDiffuse, 0.000000),
            //ColorStop(vec3(0.000000f, 0.000000f, 0.015996f), 0.000000f), ColorStop(vec3(0.008023f, 0.002428f, 0.162029f), 0.300000f), ColorStop(vec3(0.590619f, 0.964686f, 0.428690f), 0.400000f), ColorStop(vec3(0.991102f, 0.031896f, 0.814847f), 0.600000f), ColorStop(vec3(1.000000f, 0.000000f, 0.001821f), 0.800000f), ColorStop(vec3(0.008023f, 0.002428f, 0.162029f), 0.900000f), ColorStop(vec3(0.000000f, 0.000000f, 0.015996f), 1.000000f));
            ColorStop(surface.colorDiffuse, 0.000000f), ColorStop(vec3(0.008023f, 0.002428f, 0.162029f), 0.300000f), ColorStop(vec3(0.590619f, 0.964686f, 0.428690f), 0.400000f), ColorStop(vec3(0.991102f, 0.031896f, 0.814847f), 0.600000f), ColorStop(vec3(1.000000f, 0.000000f, 0.001821f), 0.800000f), ColorStop(vec3(0.008023f, 0.002428f, 0.162029f), 0.900000f), ColorStop(vec3(0.000000f, 0.000000f, 0.015996f), 1.000000f));
            
            vec3 finalColor;
            COLOR_RAMP(colors, sdfValue, finalColor);
            return vec3(finalColor);
        }
        `

        this.#canvas;
        this.#gl;
        this.#programInfo;
        this.#buffers;
        this.#numCommands = 0;
        this.#commandBuffer = new Int32Array(SdfCanvas.MAX_NUM_COMMANDS);
        this.#geometryBuffer = new Float32Array(SdfCanvas.MAX_SIZE_ELEMENT_BUFFER * 4);
        this.#shadingBuffer = new Float32Array(SdfCanvas.MAX_SIZE_ELEMENT_BUFFER * 4);

        this.overwriteLayers = new Map();
        // this.#overwriteLayers.set(1, new SdfLayer(SdfCommands.SMOOTH_UNION, 50));
    }

    async initWebgl() {
        this.#canvas = document.getElementById(this.#canvasName);

        // Initialize the GL context
        this.#gl = this.#canvas.getContext("webgl2");

        // Only continue if WebGL is available and working
        if (this.#gl === null) {
            alert(
                "Unable to initialize WebGL. Your browser or machine may not support it.",
            );
            return;
        }

        // Bake the Letter Sdfs
        this.#gl.getExtension('EXT_color_buffer_float');
        this.#gl.getExtension('OES_texture_float_linear');

        if (!SdfCanvas.bakedGlyphsTexture) {
            await SdfCanvas.#bakeLetterSdfs(this.#gl);
            SdfCanvas.bakedGlyphsTexture = true;
        }

        this.resizeCanvasToDisplaySize();

        // Set clear color to black, fully opaque
        this.#gl.clearColor(0.0, 0.0, 0.0, 1.0);
        // Clear the color buffer with specified clear color
        this.#gl.clear(this.#gl.COLOR_BUFFER_BIT);

        let { vertexSource, fragmentSource } = await loadShadersFromDisk("vertex.glsl", "fragment.glsl");

        // Initialize a shader program; this is where all the lighting
        // for the vertices and so forth is established.
        const startTime = performance.now()

        // Change the vertex according to the canvas settings
        let defines = "";
        if (this.twoDMode) {
            defines += "#define TWO_D_MODE\n";
        }
        if (this.useAA) {
            defines += "#define AA\n";
        }
        if (this.useCustomShadeFunction) {
            defines += "#define CUSTOM_SHADE_FUNCTION"
            fragmentSource = injectGLSL(fragmentSource, "SHADE_FUNCTION", this.customShadeFunction);
        }

        fragmentSource = injectGLSL(fragmentSource, "DEFINES", defines)

        const shaderProgram = await initShaderProgram(this.#gl, vertexSource, fragmentSource);

        const endTime = performance.now()
        console.log(`Call to doSomething took ${endTime - startTime} milliseconds`)


        console.log("after initShaderProgram")
        // Collect all the info needed to use the shader program.
        // Look up which attribute our shader program is using
        // for aVertexPosition and look up uniform locations.
        this.#programInfo = {
            canvas: this.#canvas,
            program: shaderProgram,
            attribLocations: {
                vertexPosition: 0,
                vertexUv: this.#gl.getAttribLocation(shaderProgram, "aVertexUv"),
            },
            uniformLocations: {
                resolution: this.#gl.getUniformLocation(shaderProgram, "uResolution"),

                top: this.#gl.getUniformLocation(shaderProgram, "uTopOffset"),
                left: this.#gl.getUniformLocation(shaderProgram, "uLeftOffset"),
                width: this.#gl.getUniformLocation(shaderProgram, "uWindowWidth"),
                height: this.#gl.getUniformLocation(shaderProgram, "uWindowHeight"),

                cameraZ: this.#gl.getUniformLocation(shaderProgram, "uCameraZ"),
                twoDMode: this.#gl.getUniformLocation(shaderProgram, "uTwoDMode"),

                numCommands: this.#gl.getUniformLocation(shaderProgram, "uNumCommands"),

                // Uniforms for the Glyph Texture
                sdfArray: this.#gl.getUniformLocation(shaderProgram, 'uSdfArray'),
                boxMin: this.#gl.getUniformLocation(shaderProgram, "uBoxMin"),
                boxMax: this.#gl.getUniformLocation(shaderProgram, "uBoxMax"),

                commandBlock: this.#gl.getUniformBlockIndex(shaderProgram, "CommandBlock"),
                geometryBlock: this.#gl.getUniformBlockIndex(shaderProgram, "GeometryBlock"),
                shadingBlock: this.#gl.getUniformBlockIndex(shaderProgram, "ShadingBlock")
            },
        };

        // Here's where we call the routine that builds all the
        // objects we'll be drawing.
        this.#buffers = initBuffers(this.#gl, this.#programInfo);

        /* const maxBytes = this.#gl.getParameter(this.#gl.MAX_UNIFORM_BLOCK_SIZE);
        console.log("Max UBO Size:", maxBytes, "bytes");
     
        const maxBindings = this.#gl.getParameter(this.#gl.MAX_UNIFORM_BUFFER_BINDINGS);
        console.log("max bindings:", maxBindings); // Usually 24, 36, or higher
     
        const maxFragBlocks = this.#gl.getParameter(this.#gl.MAX_FRAGMENT_UNIFORM_BLOCKS);
        console.log("max fragment blocks:", maxFragBlocks) */

        window.addEventListener("resize", () => {
            this.resizeCanvasToDisplaySize();
            this.#updateUniforms();
            this.draw();
        });

        this.#updateUniforms();
        this.#ready = true;
    }

    draw() {
        this.#gl.clearColor(1.0, 0.0, 1.0, 1.0); // Clear to black, fully opaque
        this.#gl.clearDepth(1.0); // Clear everything
        this.#gl.enable(this.#gl.DEPTH_TEST); // Enable depth testing
        this.#gl.depthFunc(this.#gl.LEQUAL); // Near things obscure far things

        // Clear the canvas before we start drawing on it.
        this.#gl.clear(this.#gl.COLOR_BUFFER_BIT | this.#gl.DEPTH_BUFFER_BIT);

        // Tell WebGL how to pull out the positions from the position
        // buffer into the vertexPosition attribute.
        // setPositionAttribute(gl, buffers, programInfo);
        // setColorAttribute(gl, buffers, programInfo);
        // setUvAttribute(gl, buffers, programInfo);
        // Tell WebGL which indices to use to index the vertices
        this.#gl.bindVertexArray(this.#buffers.vao);

        // Tell WebGL to use our program when drawing
        this.#gl.useProgram(this.#programInfo.program);

        // Bind the baked SDF array to texture unit 0
        this.#gl.activeTexture(this.#gl.TEXTURE0);
        this.#gl.bindTexture(this.#gl.TEXTURE_2D_ARRAY, SdfCanvas.glyphsTexture);

        // Set uniform buffer values
        this.#updateUniformBuffers();

        this.#gl.uniform1i(this.#programInfo.uniformLocations.numCommands, this.#numCommands);

        this.#gl.bindBuffer(this.#gl.UNIFORM_BUFFER, this.#buffers.commandBuffer);
        this.#gl.bufferSubData(this.#gl.UNIFORM_BUFFER, 0, this.#commandBuffer);

        this.#gl.bindBuffer(this.#gl.UNIFORM_BUFFER, this.#buffers.geometryBuffer);
        this.#gl.bufferSubData(this.#gl.UNIFORM_BUFFER, 0, this.#geometryBuffer);

        this.#gl.bindBuffer(this.#gl.UNIFORM_BUFFER, this.#buffers.shadingBuffer);
        this.#gl.bufferSubData(this.#gl.UNIFORM_BUFFER, 0, this.#shadingBuffer);

        // Draw Scene
        {
            const offset = 0;
            const vertexCount = 4;
            this.#gl.drawArrays(this.#gl.TRIANGLE_STRIP, offset, vertexCount);
        }
    }

    #updateUniforms() {
        this.#gl.useProgram(this.#programInfo.program);

        // Tells the uSdfArray uniform to look at gl.TEXTURE0
        this.#gl.uniform1i(this.#programInfo.uniformLocations.sdfArray, 0);
        this.#gl.uniform2f(this.#programInfo.uniformLocations.boxMin, SdfCanvas.GLYPHS_MAX_BOUNDING_BOX[0][0] - SdfCanvas.GLYPHS_PADDING, SdfCanvas.GLYPHS_MAX_BOUNDING_BOX[0][1] - SdfCanvas.GLYPHS_PADDING);
        this.#gl.uniform2f(this.#programInfo.uniformLocations.boxMax, SdfCanvas.GLYPHS_MAX_BOUNDING_BOX[1][0] + SdfCanvas.GLYPHS_PADDING, SdfCanvas.GLYPHS_MAX_BOUNDING_BOX[1][1] + SdfCanvas.GLYPHS_PADDING);

        this.#gl.uniform2f(this.#programInfo.uniformLocations.resolution, window.innerWidth, window.innerHeight);

        const rect = this.#canvas.getBoundingClientRect();
        this.#gl.uniform1f(this.#programInfo.uniformLocations.top, rect.top / window.innerWidth);
        this.#gl.uniform1f(this.#programInfo.uniformLocations.left, rect.left / window.innerWidth);
        this.#gl.uniform1f(this.#programInfo.uniformLocations.width, (rect.right - rect.left) / window.innerWidth);
        this.#gl.uniform1f(this.#programInfo.uniformLocations.height, (rect.bottom - rect.top) / window.innerWidth);

        this.#gl.uniform1f(this.#programInfo.uniformLocations.cameraZ, this.cameraZ);
        this.#gl.uniform1i(this.#programInfo.uniformLocations.twoDMode, this.twoDMode);
    }

    #updateUniformBuffers() {
        this.#updateUniforms();
        const oneOverX = 1 / window.innerWidth;
        const glyphsUnpaddedHeight = SdfCanvas.GLYPHS_MAX_BOUNDING_BOX[1][1] - SdfCanvas.GLYPHS_MAX_BOUNDING_BOX[0][1];
        const glyphsUnpaddedWidth = SdfCanvas.GLYPHS_MAX_BOUNDING_BOX[1][0] - SdfCanvas.GLYPHS_MAX_BOUNDING_BOX[0][0];
        const glyphsPaddedWidth = glyphsUnpaddedWidth + (SdfCanvas.GLYPHS_PADDING * 2);

        let commandBufferIdx = 0;
        let geometryBufferIdx = 0;
        let elementIdx = 0;

        const sizeInBuffers = (numGeomentryToAdd) => {
            return commandBufferIdx + 1 < SdfCanvas.MAX_NUM_COMMANDS || (geometryBufferIdx / 4 + numGeomentryToAdd) < SdfCanvas.MAX_SIZE_ELEMENT_BUFFER;
        }

        const addToCommandBuffer = (command) => {
            this.#commandBuffer[commandBufferIdx] = command;
            this.#commandBuffer[commandBufferIdx + 1] = geometryBufferIdx / 4;
            commandBufferIdx += 4;
        }

        const addToCommandBufferIfSize = (command, numGeomentryToAdd) => {
            if (!sizeInBuffers(numGeomentryToAdd)) {
                return false;
            }
            addToCommandBuffer(command);
            return true;
        }

        allElementsLoop:
        for (let layerIdx = 0; layerIdx < SdfCanvas.#layers.length; layerIdx++) {
            const layer = SdfCanvas.#layers[layerIdx];
            let layerOperation = layer.layerOperation;
            let smoothingFactor = layer.smoothingFactor;

            if (layer.elementsInLayer == 0) {
                continue;
            }

            if (this.overwriteLayers.has(layerIdx)) {
                const overwriteLayer = this.overwriteLayers.get(layerIdx);
                layerOperation = overwriteLayer.layerOperation;
                smoothingFactor = overwriteLayer.smoothingFactor;
            }

            if (!addToCommandBufferIfSize(SdfCommands.SET_LAYER_DATA, 1)) {
                break allElementsLoop;
            };
            this.#geometryBuffer[geometryBufferIdx] = SdfCanvas.#intToFloatBits(layerOperation);
            this.#geometryBuffer[geometryBufferIdx + 1] = smoothingFactor * oneOverX;
            geometryBufferIdx += 4;

            for (let i = 0; i < layer.elementsInLayer; i++) {
                const element = SdfCanvas.#trackedElements[elementIdx++];

                // check if we even want to render that element
                if (!this.#containedInRenderLayers(element)) {
                    continue;
                }

                const elementType = element.getElementType();
                const savedGeometryBufferIdx = geometryBufferIdx;

                if (elementType == SdfCommands.TEXT) {
                    element.update();
                    if (element.numLetters <= 0) { // skip empty strings
                        continue;
                    }
                }

                if (!addToCommandBufferIfSize(SdfCommands.LOAD_ELEMENT_MATRIX_AND_MATERIAL, 3)) {
                    break allElementsLoop;
                };

                const rect = element.getBoundingClientRect();
                const computedStyle = getComputedStyle(element);
                let mat = Matrix.parseMatrix(computedStyle.transform);

                const halfWidth = element.offsetWidth * oneOverX * 0.5;
                const halfHeight = element.offsetHeight * oneOverX * 0.5; //parseInt(computedStyle.getPropertyValue("font-size")) * oneOverX * 0.5 
                const halfDepth = this.twoDMode ? 100 : parseFloat(computedStyle.getPropertyValue("--depth")) * oneOverX * 0.5;

                const offsetX = (rect.left + rect.width * 0.5) * oneOverX;
                const offsetY = (rect.top + rect.height * 0.5) * oneOverX;
                const offsetZ = this.twoDMode ? 0 : parseFloat(computedStyle.getPropertyValue("--z")) * oneOverX;

                // calculate computedStyle.transform @ T(offsetX, offsetY, offsetZ)
                mat[12] = offsetX; // + mat[12] * oneOverX;
                mat[13] = offsetY; // + mat[13] * oneOverX;
                mat[14] = offsetZ + mat[14] * oneOverX; // for tx and ty this is covered by the boundingClientRect
                mat[15] = 1;
                const originalTz = mat[14]; // this is needed to compute the glyph z-positions for text

                // if I want the surface to be the top surface
                /* mat[12] -= mat[8] * halfDepth;
                mat[13] -= mat[9] * halfDepth;
                mat[14] -= mat[10] * halfDepth; */

                // invert the matrix
                Matrix.invertAffineMat4InPlace(mat);

                // Inverse affine modelview matrix = computedStyle.transform @ T(offsetX, offsetY, offsetZ), computedStyle.transform used without translation since that is already in boundingclientrect
                this.#geometryBuffer[geometryBufferIdx + 0] = mat[0]; // column 1 [mat[0], mat[1], mat[2], 0]^T
                this.#geometryBuffer[geometryBufferIdx + 1] = mat[1];
                this.#geometryBuffer[geometryBufferIdx + 2] = mat[2];

                this.#geometryBuffer[geometryBufferIdx + 3] = mat[4]; // column 2 [mat[4], mat[5], mat[6], 0]^T
                this.#geometryBuffer[geometryBufferIdx + 4] = mat[5];
                this.#geometryBuffer[geometryBufferIdx + 5] = mat[6];

                this.#geometryBuffer[geometryBufferIdx + 6] = mat[8]; // column 3 [mat[8], mat[9], mat[10], 0]^T
                this.#geometryBuffer[geometryBufferIdx + 7] = mat[9];
                this.#geometryBuffer[geometryBufferIdx + 8] = mat[10];

                this.#geometryBuffer[geometryBufferIdx + 9] = mat[12]; // tx, column 4 [tx, ty, tz, 1]^T
                this.#geometryBuffer[geometryBufferIdx + 10] = mat[13]; // ty
                this.#geometryBuffer[geometryBufferIdx + 11] = mat[14]; // tz

                // Shading Information
                this.#shadingBuffer[geometryBufferIdx + 0] = SdfCanvas.#intToFloatBits(SdfCanvas.#cssColorToUint32(computedStyle.getPropertyValue("--diffuse-color"))); // diffuse color
                this.#shadingBuffer[geometryBufferIdx + 1] = SdfCanvas.#intToFloatBits(SdfCanvas.#cssColorToUint32(computedStyle.getPropertyValue("--specular-color"))); // specular color
                this.#shadingBuffer[geometryBufferIdx + 2] = SdfCanvas.#intToFloatBits(SdfCanvas.#cssColorToUint32(computedStyle.getPropertyValue("--ambient-color"))); // ambient color
                this.#shadingBuffer[geometryBufferIdx + 3] = parseFloat(computedStyle.getPropertyValue("--kd")); // diffuse material property

                this.#shadingBuffer[geometryBufferIdx + 4] = parseFloat(computedStyle.getPropertyValue("--ks")); // specular material property
                this.#shadingBuffer[geometryBufferIdx + 5] = parseFloat(computedStyle.getPropertyValue("--p")); // specular exponent
                this.#shadingBuffer[geometryBufferIdx + 6] = parseFloat(computedStyle.getPropertyValue("--ka")); // ambient material property
                this.#shadingBuffer[geometryBufferIdx + 7] = 1.; // unused for now
                geometryBufferIdx += 3 * 4;

                // Add modifiers
                const modifiers = element.modifiers;
                for (let modifierIdx = 0; modifierIdx < modifiers.length; modifierIdx++) {
                    const modifier = modifiers[modifierIdx];
                    const modifierType = modifier.getModifierType();
                    addToCommandBuffer(modifierType);

                    if (!addToCommandBufferIfSize(modifierType, modifier.getModifierSize())) {
                        break allElementsLoop;
                    };

                    let targetOffsetX = 0;
                    let targetOffsetY = 0;
                    let targetOffsetZ = 0;

                    if (modifier.target != null) {
                        targetOffsetX = this.#geometryBuffer[savedGeometryBufferIdx + 9];
                        targetOffsetY = this.#geometryBuffer[savedGeometryBufferIdx + 10];
                        targetOffsetZ = this.#geometryBuffer[savedGeometryBufferIdx + 11];

                        const targetRect = modifier.target.getBoundingClientRect();
                        targetOffsetX += (targetRect.left + targetRect.width * 0.5) * oneOverX;
                        targetOffsetY += (targetRect.top + targetRect.height * 0.5) * oneOverX;
                        targetOffsetZ += this.twoDMode ? 0 : parseFloat(getComputedStyle(modifier.target).getPropertyValue("--z")) * oneOverX;
                    }

                    if (elementType == SdfCommands.TEXT) { // text has the origin at the bottom-left not in the center like the other elements
                        const { x, y } = element.getOffsetToCenter();
                        targetOffsetX += x * oneOverX;
                        targetOffsetY += y * oneOverX; // height * 0.5 * oneOverX;
                    }

                    switch (modifierType) {
                        case SdfCommands.TWIST:

                            this.#geometryBuffer[geometryBufferIdx + 0] = targetOffsetX; // ofset
                            this.#geometryBuffer[geometryBufferIdx + 1] = targetOffsetY; // ofset
                            this.#geometryBuffer[geometryBufferIdx + 2] = targetOffsetZ; // ofset
                            this.#geometryBuffer[geometryBufferIdx + 3] = modifier.amount / oneOverX; // amount

                            this.#geometryBuffer[geometryBufferIdx + 4] = modifier.axis[0]; // axis
                            this.#geometryBuffer[geometryBufferIdx + 5] = modifier.axis[1]; // axis
                            this.#geometryBuffer[geometryBufferIdx + 6] = modifier.axis[2]; // axis
                            break;
                    }

                    geometryBufferIdx += modifier.getModifierSize() * 4;
                }

                if (!addToCommandBufferIfSize(elementType, SdfCanvas.#getElementSize(element))) {
                    break allElementsLoop;
                };

                // Element specific data
                switch (elementType) {
                    case SdfCommands.SPHERE:
                        this.#geometryBuffer[geometryBufferIdx + 0] = parseFloat(computedStyle.getPropertyValue("--r")) * oneOverX * 0.5; // radius 
                        break;
                    case SdfCommands.BOX_SIMPLE:
                        this.#geometryBuffer[geometryBufferIdx + 0] = halfWidth; // width 
                        this.#geometryBuffer[geometryBufferIdx + 1] = halfHeight; // height 
                        this.#geometryBuffer[geometryBufferIdx + 2] = halfDepth; // depth
                        this.#geometryBuffer[geometryBufferIdx + 3] = parseFloat(computedStyle.getPropertyValue("--extrude")) * oneOverX; // rounding
                        break;
                    case SdfCommands.BOX:
                        this.#geometryBuffer[geometryBufferIdx + 0] = halfWidth; // width 
                        this.#geometryBuffer[geometryBufferIdx + 1] = halfHeight; // height 
                        this.#geometryBuffer[geometryBufferIdx + 2] = halfDepth; // depth
                        this.#geometryBuffer[geometryBufferIdx + 3] = 0; // still unused

                        this.#geometryBuffer[geometryBufferIdx + 4] = parseFloat(computedStyle.borderBottomRightRadius) * oneOverX;
                        this.#geometryBuffer[geometryBufferIdx + 5] = parseFloat(computedStyle.borderTopRightRadius) * oneOverX;
                        this.#geometryBuffer[geometryBufferIdx + 6] = parseFloat(computedStyle.borderBottomLeftRadius) * oneOverX;
                        this.#geometryBuffer[geometryBufferIdx + 7] = parseFloat(computedStyle.borderTopLeftRadius) * oneOverX;

                        this.#geometryBuffer[geometryBufferIdx + 8] = SdfCanvas.#intToFloatBits(parseInt(computedStyle.getPropertyValue("--border-radius-type"))); // border radius
                        this.#geometryBuffer[geometryBufferIdx + 9] = SdfCanvas.#intToFloatBits(parseInt(computedStyle.getPropertyValue("--rotation-offset"))); // initial rotation
                        this.#geometryBuffer[geometryBufferIdx + 10] = parseFloat(computedStyle.getPropertyValue("--extrude")) * oneOverX; // rounding
                        break;
                    case SdfCommands.TEXT:
                        // The text expects an array of letters where the x,y,z position is at the same place as the origin of the letters in "glyph-space"
                        // The scale is how big the texture is in world space (including padding), send inverse scale so that we can multiply by it to get to glyph-space 
                        const rects = element.getWordRects();
                        const letterHeight = element.measureHeight(rects[0][0]) * oneOverX;
                        const glpyhSpaceScale = letterHeight / glyphsUnpaddedHeight; // how much one unit of "glyph-space" is in world-space 
                        this.#geometryBuffer[geometryBufferIdx + 0] = SdfCanvas.#intToFloatBits(element.numLetters); // amount of letters
                        this.#geometryBuffer[geometryBufferIdx + 1] = 1 / (glyphsPaddedWidth * glpyhSpaceScale); // inverse letter scale 
                        this.#geometryBuffer[geometryBufferIdx + 2] = halfDepth; // depth 
                        this.#geometryBuffer[geometryBufferIdx + 3] = Math.max(parseFloat(computedStyle.getPropertyValue("--letterSmoothness")) * oneOverX, 0.0001); // smoothness between letters

                        let inverseMat3 = Matrix.extractMat3FromMat4(mat);
                        let wordCenterLocal = new Float32Array(3);
                        let referenceX, referenceY, referenceZ = 0;

                        let letterIdx = 0;
                        textOuterLoop:
                        for (const [currentText, currentRect] of rects) {
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

                            for (let currentLetterIdx = 0; currentLetterIdx < currentText.length; currentLetterIdx++) {
                                let currentSubstringWidth = element.measure(currentText.substring(0, currentLetterIdx)) * oneOverX;
                                const currentLetter = currentText.charAt(currentLetterIdx);
                                if (currentLetter == "t") {
                                    currentSubstringWidth += 22.5 * glpyhSpaceScale;// * oneOverX;
                                }

                                if (letterIdx == 0) {
                                    // the first letter is the reference point and for all the other letters an offset to the first one is stored
                                    this.#geometryBuffer[savedGeometryBufferIdx + 9] = -wordCenterLocal[0] - (wordLeftEdgeLocalX + currentSubstringWidth);; // tx, column 4 [tx, ty, tz, 1]^T
                                    this.#geometryBuffer[savedGeometryBufferIdx + 10] = -wordCenterLocal[1] - letterHeight * 0.5 + SdfCanvas.GLYPHS_PADDING * glpyhSpaceScale; // ty
                                    this.#geometryBuffer[savedGeometryBufferIdx + 11] = -wordCenterLocal[2]; // tz

                                    this.#geometryBuffer[geometryBufferIdx + 4 + letterIdx * 4 + 0] = parseFloat(computedStyle.getPropertyValue("--extrude")) * oneOverX; // rounding
                                    this.#geometryBuffer[geometryBufferIdx + 4 + letterIdx * 4 + 1] = 0; // still unused
                                    this.#geometryBuffer[geometryBufferIdx + 4 + letterIdx * 4 + 2] = 0; // still unused

                                    referenceX = wordCenterLocal[0] + wordLeftEdgeLocalX;
                                    referenceY = wordCenterLocal[1];
                                    referenceZ = wordCenterLocal[2];
                                } else {
                                    const difx = wordCenterLocal[0] + wordLeftEdgeLocalX - referenceX;
                                    const dify = wordCenterLocal[1] - referenceY;
                                    const difz = wordCenterLocal[2] - referenceZ; // should be 0

                                    this.#geometryBuffer[geometryBufferIdx + 4 + letterIdx * 4 + 0] = - (difx + currentSubstringWidth); // offsetX
                                    this.#geometryBuffer[geometryBufferIdx + 4 + letterIdx * 4 + 1] = - dify; // offsetY
                                    this.#geometryBuffer[geometryBufferIdx + 4 + letterIdx * 4 + 2] = - difz; // offsetZ
                                }
                                this.#geometryBuffer[geometryBufferIdx + 4 + letterIdx * 4 + 3] = SdfCanvas.#intToFloatBits(SdfCanvas.#getCharIndex(currentLetter)); // letterCode
                                letterIdx++;
                                if (letterIdx >= element.numLetters) {
                                    break textOuterLoop;
                                }
                            }
                        }
                        break;
                }
                geometryBufferIdx += SdfCanvas.#getElementSize(element) * 4;
            }
        }

        this.#numCommands = commandBufferIdx / 4;
    }

    resizeCanvasToDisplaySize() {
        // 1. Get the pixel density of the screen (e.g., Retina screens are often 2)
        const dpr = window.devicePixelRatio || 1;

        // 2. Calculate the actual physical pixels of the display area
        const displayWidth = this.#canvas.clientWidth * dpr;
        const displayHeight = this.#canvas.clientHeight * dpr;

        // 3. Apply your downscale factor to determine the WebGL rendering resolution
        // (Math.max is used to prevent the canvas from ever being 0x0 pixels)
        const renderWidth = Math.max(1, Math.round(displayWidth / this.downscaleFactorX));
        const renderHeight = Math.max(1, Math.round(displayHeight / this.downscaleFactorY));

        // 4. If the rendering resolution changed, update the canvas and viewport
        if (this.#canvas.width !== renderWidth || this.#canvas.height !== renderHeight) {

            // This changes the internal rendering resolution (the WebGL buffer size)
            this.#canvas.width = renderWidth;
            this.#canvas.height = renderHeight;

            // The WebGL viewport MUST match the internal buffer size, 
            this.#gl.viewport(0, 0, renderWidth, renderHeight);
        }
    }

    #containedInRenderLayers(element) {
        const elementRenderLayers = element.dataset.renderLayers.split(" ").map((s) => parseInt(s));
        return this.renderLayers.some(item => elementRenderLayers.includes(item));
    }
}

export { SdfCanvas }