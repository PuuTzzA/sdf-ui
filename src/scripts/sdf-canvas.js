import { loadShadersFromDisk, initShaderProgram, initBuffers, injectGLSL, toGlslVec2Array } from "./helper/webgl-helper-functions.js";
import { Matrix } from "./helper/matrix.js";
import { SdfCommands } from "./sdf-commands.js";
import { SdfLayer } from "./sdf-layer.js";

class SdfCanvas {
    // ╔══════════════════════════════════════════════════════════╗
    // ║                       Constants                          ║
    // ╚══════════════════════════════════════════════════════════╝
    static MAX_NUM_COMMANDS = 1024; // maximum number of commands per canvas
    static MAX_SIZE_ELEMENT_BUFFER = 1024; // number of vec4 in the buffer
    static MAX_NUM_LIGHTS = 128; // maximum number of lights per canvas 

    static VEC4_PER_LIGHT = 3; // amount of vec4 used for each light

    static COMMAND_BLOCK_UNIFORM_BUFFER_BINDING_INDEX = 0;
    static GEOMETRY_BLOCK_UNIFORM_BUFFER_BINDING_INDEX = 1;
    static SHADING_BLOCK_UNIFORM_BUFFER_BINDING_INDEX = 2;
    static LIGHT_BLOCK_UNIFORM_BUFFER_BINDING_INDEX = 3;

    static COMPILE_POLICY_ONLY_PARALLEL = 0;
    static COMPILE_POLICY_ALSO_BLOCKING = 1;

    // ╔══════════════════════════════════════════════════════════╗
    // ║                      Glyphs Texture                      ║
    // ╚══════════════════════════════════════════════════════════╝
    static GLYPH_TEXTURE_RESOLUTION = 1028; // Resolution along the longer axis
    static NUM_GLYPHS_BUFFERED = 36;
    static GLYPHS_MAX_BOUNDING_BOX = [[-45, -200], [135, 700]]; // box which ALL glyphs fall into in the format [[left, bot], [right, top]]
    static GLYPHS_PADDING = 200; // padding that is applied to all sides of the max bounding box

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
        // I tried to store the texture in RAM, but moving the texture from VRAM to RAM and then back to VRAM is slower than just doing it again 
        const { resolutionX, resolutionY } = SdfCanvas.#computeGlyphTextureResolution();
        const depth = SdfCanvas.NUM_GLYPHS_BUFFERED + 1;

        const { vertexSource, fragmentSource } = await loadShadersFromDisk("letterBakingVertex.glsl", "letterBakingFragment.glsl");
        const bakeProg = await initShaderProgram(gl, vertexSource, fragmentSource);

        // There are no awaits below here, so initWebgl cannot interrupt it
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R32F, resolutionX, resolutionY, depth);

        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR); // Texture minification filter
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR); // Texture magnification filter
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); // Wrapping function for texture coordinate s
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); // Wrapping function for texture coordinate t

        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

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

        // Render each layer
        for (let i = 0; i < depth; i++) {
            // framebufferTextureLayer(target, attachment, texture, level, layer) attaches a single layer of a texture to a framebuffer
            gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, texture, 0, i);

            // Tell the shader which character to compute
            gl.uniform1i(charIndexLoc, i);

            // drawArrays(mode, first (starting index), count (num of vertices))
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }

        // 3. CLEANUP STATE
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
        gl.deleteBuffer(quadBuffer);
        gl.deleteProgram(bakeProg);
        gl.deleteFramebuffer(fbo);

        return texture;
    }

    // ╔══════════════════════════════════════════════════════════╗
    // ║             Static Properties and Methods                ║
    // ╚══════════════════════════════════════════════════════════╝
    static customElements = [];

    static #instantiatedCanvases = [];

    static #trackedElements = [];

    static #trackedLights = [];

    static #layers = [
        new SdfLayer(SdfCommands.SMOOTH_UNION, 30),
    ]

    static #resolveColorCtx; // to convert hsl, oklch, ... to rgba

    static get layers() {
        return this.#layers;
    }

    static set layers(val) {
        this.#layers = val;
        this.#updateLayers();
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

    static addTrackedLight(light) {
        this.#trackedLights.push(light);
    }

    static removeTrackedLight(light) {
        const index = this.#trackedLights.indexOf(light);
        if (index <= -1) {
            return;
        }
        this.#trackedLights.splice(index, 1);
    }

    /**
    * Performs the passed function for every tracked element.
    * Usefull for e.g. adding or removing css classes.
    * @param {Function} f - The callback function to execute for each element.
    */
    static performForEachElement(f) {
        this.#trackedElements.forEach((e) => {
            f(e);
        })
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
            case SdfCommands.CYLINDER:
                return 1;
            case SdfCommands.TRIANGLE:
                return 2;
            case SdfCommands.CUSTOM:
                return 1;
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
        // Create a persistent canvas for parsing
        if (!this.#resolveColorCtx) {
            const canvas = new OffscreenCanvas(1, 1);
            this.#resolveColorCtx = canvas.getContext('2d', { willReadFrequently: true });
        }

        // Setting fillStyle handles oklch, hsl, hex, named colors, etc.
        this.#resolveColorCtx.fillStyle = css;
        this.#resolveColorCtx.clearRect(0, 0, 1, 1);
        this.#resolveColorCtx.fillRect(0, 0, 1, 1);

        // Grab the computed RGBA values
        const [r, g, b, a] = this.#resolveColorCtx.getImageData(0, 0, 1, 1).data;
        return { r: r / 255, g: g / 255, b: b / 255, a: a / 255 };
    }

    // ╔══════════════════════════════════════════════════════════╗
    // ║                        SdfCanvas                         ║
    // ╚══════════════════════════════════════════════════════════╝
    // Public members
    renderLayers;
    #ready; // no setter
    #downscaleFactorX;
    #downscaleFactorY;
    topFace;

    cameraZ;
    useAA;
    twoDMode;
    customShadeFunction;
    onCompilationComplete;

    // Private Properties
    #canvasName;
    #canvas;
    #gl;
    #programInfo;
    #buffers;
    #numCommands;
    #numLights;
    #commandBuffer;
    #geometryBuffer;
    #shadingBuffer;
    #lightBuffer;
    #overwriteLayers;
    #lastCustomIdx;
    #glyphTexture;

    // Getters and Setters
    get canvas() {
        return this.#canvas;
    }

    get ready() {
        return this.#ready;
    }

    get downscaleFactorX() {
        return this.#downscaleFactorX;
    }

    set downscaleFactorX(val) {
        this.#downscaleFactorX = val;
        if (this.#ready) {
            this.#resizeCanvasToDisplaySize();
        }
    }

    get downscaleFactorY() {
        return this.#downscaleFactorY;
    }

    set downscaleFactorY(val) {
        this.#downscaleFactorY = val;
        if (this.#ready) {
            this.#resizeCanvasToDisplaySize();
        }
    }

    constructor(canvasName, options = {}) {
        SdfCanvas.#instantiatedCanvases.push(this);

        // Required and private mebers
        this.#canvasName = canvasName;
        this.#overwriteLayers = new Map();
        this.#ready = false;

        this.#canvas;
        this.#gl;
        this.#programInfo;
        this.#buffers;
        this.#numCommands = 0;
        this.#commandBuffer = new Int32Array(SdfCanvas.MAX_NUM_COMMANDS * 4);
        this.#geometryBuffer = new Float32Array(SdfCanvas.MAX_SIZE_ELEMENT_BUFFER * 4);
        this.#shadingBuffer = new Float32Array(SdfCanvas.MAX_SIZE_ELEMENT_BUFFER * 4);
        this.#lightBuffer = new Float32Array(SdfCanvas.MAX_NUM_LIGHTS * SdfCanvas.VEC4_PER_LIGHT * 4);

        // User parameters
        const {
            renderLayers = [0],
            downscaleFactorX = 2,
            downscaleFactorY = 2,
            topFace = false,
            cameraZ = 10,
            useAA = false,
            twoDMode = false,
            customShadeFunction = "",
            onCompilationComplete = undefined,
        } = options;

        this.renderLayers = renderLayers;
        this.#downscaleFactorX = downscaleFactorX;
        this.#downscaleFactorY = downscaleFactorY;
        this.topFace = topFace;

        this.cameraZ = cameraZ;
        this.useAA = useAA;
        this.twoDMode = twoDMode;
        this.customShadeFunction = customShadeFunction;
        this.onCompilationComplete = onCompilationComplete;
    }

    /**
     * Initializes WebGL.
     * @param {number} compilePolicy - If compilation should continue even if background compilation is not available. Should be SdfCanvas.COMPILE_POLICY_ONLY_PARALLEL or SdfCanvas.COMPILE_POLICY_ALSO_BLOCKING
     * @returns {Promise<boolean>} Boolean if compilation was successful.
     */
    async initWebgl(compilePolicy = SdfCanvas.COMPILE_POLICY_ALSO_BLOCKING) {
        this.#canvas = document.getElementById(this.#canvasName, { powerPreference: "high-performance" });

        // Initialize the GL context
        this.#gl = this.#canvas.getContext("webgl2");

        // Only continue if WebGL is available and working
        if (this.#gl === null) {
            alert("Unable to initialize WebGL. Your browser or machine may not support it.");
            return false;
        }

        const parallelCompileExt = this.#gl.getExtension("KHR_parallel_shader_compile");
        if (compilePolicy == SdfCanvas.COMPILE_POLICY_ONLY_PARALLEL && !parallelCompileExt) {
            return false;
        }

        // Bake the Letter Sdfs
        this.#gl.getExtension('EXT_color_buffer_float');
        this.#gl.getExtension('OES_texture_float_linear');

        const textureSetupPromise = (async () => {
            this.#glyphTexture = await SdfCanvas.#bakeLetterSdfs(this.#gl);
        })();

        // Continue with the rest of the setup
        // Set clear color to black, fully opaque
        this.#gl.clearColor(0.0, 0.0, 0.0, 1.0);
        // Clear the color buffer with specified clear color
        this.#gl.clear(this.#gl.COLOR_BUFFER_BIT);

        let { vertexSource, fragmentSource } = await loadShadersFromDisk("vertex.glsl", "fragment.glsl");

        // Initialize a shader program; this is where all the lighting
        // Change the vertex according to the canvas settings
        let defines = "";
        if (this.twoDMode) {
            defines += "#define TWO_D_MODE\n";
        }
        if (this.useAA) {
            defines += "#define AA\n";
        }
        if (this.customShadeFunction != "") {
            defines += "#define CUSTOM_SHADE_FUNCTION"
            fragmentSource = injectGLSL(fragmentSource, "SHADE_FUNCTION", this.customShadeFunction);
        }
        fragmentSource = injectGLSL(fragmentSource, "DEFINES", defines)

        // Custom elements
        let functionString = "";
        let commandString = "";

        for (let i = 0; i < Math.min(SdfCanvas.customElements.length, SdfCommands.CUSTOM_END - SdfCommands.CUSTOM_START); i++) {
            const array = SdfCanvas.customElements[i];

            const functionName = `customElement${i}`;
            const glslArray = toGlslVec2Array(array);

            functionString += `CUSTOM_ELEMENT_FUNCTION(${functionName}, ${glslArray})`;
            commandString += `CUSTOM_ELEMENT_IF(${functionName}, ${SdfCommands.CUSTOM_START + i})`;
        }
        this.#lastCustomIdx = Math.min(SdfCommands.CUSTOM_START + SdfCanvas.customElements.length - 1, SdfCommands.CUSTOM_END);

        fragmentSource = injectGLSL(fragmentSource, "CUSTOM_ELEMENTS_FUNCTIONS", functionString);
        fragmentSource = injectGLSL(fragmentSource, "CUSTOM_ELEMENTS_COMMANDS", commandString);

        const shaderProgram = await initShaderProgram(this.#gl, vertexSource, fragmentSource);

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
                numLights: this.#gl.getUniformLocation(shaderProgram, "uNumLights"),

                // Uniforms for the Glyph Texture
                sdfArray: this.#gl.getUniformLocation(shaderProgram, 'uSdfArray'),
                boxMin: this.#gl.getUniformLocation(shaderProgram, "uBoxMin"),
                boxMax: this.#gl.getUniformLocation(shaderProgram, "uBoxMax"),

                commandBlock: this.#gl.getUniformBlockIndex(shaderProgram, "CommandBlock"),
                geometryBlock: this.#gl.getUniformBlockIndex(shaderProgram, "GeometryBlock"),
                shadingBlock: this.#gl.getUniformBlockIndex(shaderProgram, "ShadingBlock"),
                lightBlock: this.#gl.getUniformBlockIndex(shaderProgram, "LightBlock"),
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
            this.#resizeCanvasToDisplaySize();
            this.#updateUniforms();
            this.draw();
        });

        // Wait for the texture baking before returning
        await textureSetupPromise;
        this.#resizeCanvasToDisplaySize();
        this.#updateUniforms();
        if (this.onCompilationComplete != undefined) {
            this.onCompilationComplete();
        }
        this.#ready = true;
        return true;
    }

    /**
     * Renders the WebGL scene.
     * If a scissor bounding box is provided, the WebGL scissor test is enabled, 
     * restricting fragment shader execution and clearing operations to that specific 
     * rectangular area. The scissor coordinates are expected to be in standard DOM 
     * space (top-down Y axis) and are automatically mapped to WebGL buffer space.
     *  
     * @param {{x: number, y: number, w: number, h: number} | null} [scissor=null] - The bounding box for the scissor test.
     * For this function to work correctly, if `scissor` is not null, it MUST be an object containing the following numeric properties:
     * - `x`: The X coordinate of the top-left corner in DOM pixels.
     * - `y`: The Y coordinate of the top-left corner in DOM pixels.
     * - `w`: The width of the scissor box in DOM pixels.
     * - `h`: The height of the scissor box in DOM pixels.
     */
    draw(scissor = null) {
        if (!this.#ready) {
            return;
        }

        this.#gl.disable(this.#gl.SCISSOR_TEST);
        if (scissor) {
            this.#gl.clearColor(0.0, 0.0, 0.0, 0.0);
            this.#gl.clear(this.#gl.COLOR_BUFFER_BIT | this.#gl.DEPTH_BUFFER_BIT);
        }

        this.#gl.enable(this.#gl.DEPTH_TEST);
        this.#gl.depthFunc(this.#gl.LEQUAL);

        // Scissor Test: The GPU will ONLY run the fragment shader inside this box
        if (scissor) {
            this.#gl.enable(this.#gl.SCISSOR_TEST);

            // Map DOM coordinates to WebGL buffer coordinates
            const scaleX = this.#canvas.width / window.innerWidth;
            const scaleY = this.#canvas.height / window.innerHeight;

            const sx = scissor.x * scaleX;
            const sy = this.#canvas.height - ((scissor.y + scissor.h) * scaleY); // WebGL Y is bottom-up
            const sw = scissor.w * scaleX;
            const sh = scissor.h * scaleY;

            this.#gl.scissor(sx, sy, sw, sh);
        }

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
        this.#gl.bindTexture(this.#gl.TEXTURE_2D_ARRAY, this.#glyphTexture);

        // Set uniform buffer values
        this.#updateUniforms();
        this.#updateUniformBufferData();
        this.#updateLightBufferData();

        this.#gl.uniform1i(this.#programInfo.uniformLocations.numCommands, this.#numCommands);
        this.#gl.uniform1i(this.#programInfo.uniformLocations.numLights, this.#numLights);

        this.#gl.bindBuffer(this.#gl.UNIFORM_BUFFER, this.#buffers.commandBuffer);
        this.#gl.bufferSubData(this.#gl.UNIFORM_BUFFER, 0, this.#commandBuffer);

        this.#gl.bindBuffer(this.#gl.UNIFORM_BUFFER, this.#buffers.geometryBuffer);
        this.#gl.bufferSubData(this.#gl.UNIFORM_BUFFER, 0, this.#geometryBuffer);

        this.#gl.bindBuffer(this.#gl.UNIFORM_BUFFER, this.#buffers.shadingBuffer);
        this.#gl.bufferSubData(this.#gl.UNIFORM_BUFFER, 0, this.#shadingBuffer);

        this.#gl.bindBuffer(this.#gl.UNIFORM_BUFFER, this.#buffers.lightBuffer);
        this.#gl.bufferSubData(this.#gl.UNIFORM_BUFFER, 0, this.#lightBuffer);

        // Draw Scene
        {
            const offset = 0;
            const vertexCount = 4;
            this.#gl.drawArrays(this.#gl.TRIANGLE_STRIP, offset, vertexCount);
        }
    }

    /**
     * Add an overwriteLayer to the SdfCanvas. This canvas will then use this overwriteLayer's properties instead of the global SdfLayer properties.
     * @param {number} index - Index of the layer to overwrite.
     * @param {SdfLayer} overwriteLayer - SdfLayer object that overwrites that layer.
     */
    addOverwriteLayer(index, overwriteLayer) {
        this.#overwriteLayers.set(index, overwriteLayer);
    }

    /**
     * Removes an overwriteLayer from the SdfCanvas. 
     * @param {number} index - Index of the overwriteLayer to remove.
     */
    removeOverwriteLayer(index) {
        if (!this.#overwriteLayers.has(index)) {
            return;
        }
        this.#overwriteLayers.delete(index);
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

    #updateUniformBufferData() {
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

        const storeMat4InGeometryBuffer = (mat, index) => {
            this.#geometryBuffer[index + 0] = mat[0]; // column 1 [mat[0], mat[1], mat[2], 0]^T
            this.#geometryBuffer[index + 1] = mat[1];
            this.#geometryBuffer[index + 2] = mat[2];

            this.#geometryBuffer[index + 3] = mat[4]; // column 2 [mat[4], mat[5], mat[6], 0]^T
            this.#geometryBuffer[index + 4] = mat[5];
            this.#geometryBuffer[index + 5] = mat[6];

            this.#geometryBuffer[index + 6] = mat[8]; // column 3 [mat[8], mat[9], mat[10], 0]^T
            this.#geometryBuffer[index + 7] = mat[9];
            this.#geometryBuffer[index + 8] = mat[10];

            this.#geometryBuffer[index + 9] = mat[12]; // tx, column 4 [tx, ty, tz, 1]^T
            this.#geometryBuffer[index + 10] = mat[13]; // ty
            this.#geometryBuffer[index + 11] = mat[14]; // tz
        }

        allElementsLoop:
        for (let layerIdx = 0; layerIdx < SdfCanvas.#layers.length; layerIdx++) {
            const layer = SdfCanvas.#layers[layerIdx];
            let layerOperation = layer.layerOperation;
            let smoothingFactor = layer.smoothingFactor;

            if (layer.elementsInLayer == 0) {
                continue;
            }

            if (this.#overwriteLayers.has(layerIdx)) {
                const overwriteLayer = this.#overwriteLayers.get(layerIdx);
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

                if (!element.active) {
                    continue;
                }

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

                if (this.topFace) {
                    // if I want the surface to be the top surface
                    mat[12] -= mat[8] * halfDepth;
                    mat[13] -= mat[9] * halfDepth;
                    mat[14] -= mat[10] * halfDepth;
                }

                // invert the matrix
                Matrix.invertAffineMat4InPlace(mat);

                // Inverse affine modelview matrix = computedStyle.transform @ T(offsetX, offsetY, offsetZ), computedStyle.transform used without translation since that is already in boundingclientrect
                storeMat4InGeometryBuffer(mat, geometryBufferIdx)

                // Shading Information
                const diffuse = SdfCanvas.#parseCSSColor(computedStyle.getPropertyValue("--diffuse-color"));
                this.#shadingBuffer[geometryBufferIdx + 0] = diffuse.r;
                this.#shadingBuffer[geometryBufferIdx + 1] = diffuse.g;
                this.#shadingBuffer[geometryBufferIdx + 2] = diffuse.b;
                this.#shadingBuffer[geometryBufferIdx + 3] = parseFloat(computedStyle.getPropertyValue("--kd")); // diffuse material property

                const specular = SdfCanvas.#parseCSSColor(computedStyle.getPropertyValue("--specular-color"));
                this.#shadingBuffer[geometryBufferIdx + 4] = specular.r;
                this.#shadingBuffer[geometryBufferIdx + 5] = specular.g;
                this.#shadingBuffer[geometryBufferIdx + 6] = specular.b;
                this.#shadingBuffer[geometryBufferIdx + 7] = parseFloat(computedStyle.getPropertyValue("--ks")); // diffuse material property

                this.#shadingBuffer[geometryBufferIdx + 8] = parseFloat(computedStyle.getPropertyValue("--p")); // specular exponent

                const ambient = SdfCanvas.#parseCSSColor(computedStyle.getPropertyValue("--ambient-color"));
                this.#shadingBuffer[geometryBufferIdx + 12] = ambient.r;
                this.#shadingBuffer[geometryBufferIdx + 13] = ambient.g;
                this.#shadingBuffer[geometryBufferIdx + 14] = ambient.b;
                this.#shadingBuffer[geometryBufferIdx + 15] = parseFloat(computedStyle.getPropertyValue("--ka")); // diffuse material property

                geometryBufferIdx += 4 * 4;

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

                        let targetMat = Matrix.parseMatrix(computedStyle.transform);
                        targetOffsetZ += targetMat[14] * oneOverX;
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
                            this.#geometryBuffer[geometryBufferIdx + 7] = modifier.start * oneOverX; // start

                            this.#geometryBuffer[geometryBufferIdx + 8] = modifier.end * oneOverX; // end
                            break;
                    }

                    geometryBufferIdx += modifier.getModifierSize() * 4;
                }

                const savedCommandBufferIdx = commandBufferIdx;
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
                        let w = halfWidth;
                        let h = halfHeight;
                        let d = halfDepth;

                        switch (computedStyle.getPropertyValue("--rotation-offset")) {
                            case "z":
                                break;
                            case "x":
                                Matrix.mat4TimesMat4InPlace(Matrix.rotation90DegY, mat);
                                storeMat4InGeometryBuffer(mat, savedGeometryBufferIdx);

                                const temp = w;
                                w = d;
                                d = temp;
                                break;
                            case "y":
                                Matrix.mat4TimesMat4InPlace(Matrix.rotation90DegX, mat);
                                storeMat4InGeometryBuffer(mat, savedGeometryBufferIdx);

                                const temp2 = h;
                                h = d;
                                d = temp2;
                                break;
                        }

                        this.#geometryBuffer[geometryBufferIdx + 0] = w; // width 
                        this.#geometryBuffer[geometryBufferIdx + 1] = h; // height 
                        this.#geometryBuffer[geometryBufferIdx + 2] = d; // depth
                        this.#geometryBuffer[geometryBufferIdx + 3] = 0; // still unused

                        this.#geometryBuffer[geometryBufferIdx + 4] = parseFloat(computedStyle.borderBottomRightRadius) * oneOverX;
                        this.#geometryBuffer[geometryBufferIdx + 5] = parseFloat(computedStyle.borderTopRightRadius) * oneOverX;
                        this.#geometryBuffer[geometryBufferIdx + 6] = parseFloat(computedStyle.borderBottomLeftRadius) * oneOverX;
                        this.#geometryBuffer[geometryBufferIdx + 7] = parseFloat(computedStyle.borderTopLeftRadius) * oneOverX;

                        let borderType = 0;
                        switch (computedStyle.getPropertyValue("--border-radius-type")) {
                            case "circle":
                                borderType = 0;
                                break;
                            case "parabola":
                                borderType = 1;
                                break;
                            case "cosine":
                                borderType = 2;
                                break;
                            case "cubic":
                                borderType = 3;
                                break;
                        }


                        this.#geometryBuffer[geometryBufferIdx + 8] = SdfCanvas.#intToFloatBits(borderType); // border radius
                        this.#geometryBuffer[geometryBufferIdx + 9] = parseFloat(computedStyle.getPropertyValue("--extrude")) * oneOverX; // rounding
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
                    case SdfCommands.CYLINDER:
                        let height, radius;
                        switch (computedStyle.getPropertyValue("--axis")) {
                            case "x":
                                Matrix.mat4TimesMat4InPlace(Matrix.rotation90DegZ, mat);
                                storeMat4InGeometryBuffer(mat, savedGeometryBufferIdx);
                                height = halfWidth;
                                radius = halfHeight;
                                break;
                            case "y":
                                height = halfHeight;
                                radius = halfWidth;
                                break;
                            case "z":
                                Matrix.mat4TimesMat4InPlace(Matrix.rotation90DegX, mat);
                                storeMat4InGeometryBuffer(mat, savedGeometryBufferIdx);
                                radius = halfWidth;
                                height = halfDepth;
                                break;
                        }
                        this.#geometryBuffer[geometryBufferIdx + 0] = radius;
                        this.#geometryBuffer[geometryBufferIdx + 1] = height;
                        this.#geometryBuffer[geometryBufferIdx + 2] = parseFloat(computedStyle.getPropertyValue("--extrude")) * oneOverX; // rounding
                        this.#geometryBuffer[geometryBufferIdx + 3] = 0;
                        break;
                    case SdfCommands.TRIANGLE:
                        const aValues = computedStyle.getPropertyValue('--point-a');
                        const [aX, aY] = aValues.split(' ').map(val => parseFloat(val));

                        const bValues = computedStyle.getPropertyValue('--point-b');
                        const [bX, bY] = bValues.split(' ').map(val => parseFloat(val));

                        const cValues = computedStyle.getPropertyValue('--point-c');
                        const [cX, cY] = cValues.split(' ').map(val => parseFloat(val));

                        this.#geometryBuffer[geometryBufferIdx + 0] = aX * oneOverX;
                        this.#geometryBuffer[geometryBufferIdx + 1] = aY * oneOverX;
                        this.#geometryBuffer[geometryBufferIdx + 2] = bX * oneOverX;
                        this.#geometryBuffer[geometryBufferIdx + 3] = bY * oneOverX;

                        this.#geometryBuffer[geometryBufferIdx + 4] = cX * oneOverX;
                        this.#geometryBuffer[geometryBufferIdx + 5] = cY * oneOverX;
                        this.#geometryBuffer[geometryBufferIdx + 6] = halfDepth;
                        this.#geometryBuffer[geometryBufferIdx + 7] = parseFloat(computedStyle.getPropertyValue("--extrude")) * oneOverX; // rounding
                        break;
                    case SdfCommands.CUSTOM:
                        const elementIdx = Math.max(Math.min(SdfCommands.CUSTOM_START + parseInt(element.dataset.customIndex), this.#lastCustomIdx), SdfCommands.CUSTOM_START);
                        this.#commandBuffer[savedCommandBufferIdx] = elementIdx; // clamped to the appropriate range

                        this.#geometryBuffer[geometryBufferIdx + 0] = 1 / (parseFloat(computedStyle.getPropertyValue("--scale")) * oneOverX);
                        this.#geometryBuffer[geometryBufferIdx + 1] = halfDepth;
                        this.#geometryBuffer[geometryBufferIdx + 2] = parseFloat(computedStyle.getPropertyValue("--extrude")) * oneOverX; // rounding
                        break;
                }
                geometryBufferIdx += SdfCanvas.#getElementSize(element) * 4;
            }
        }

        this.#numCommands = commandBufferIdx / 4;
    }

    #updateLightBufferData() {
        const oneOverX = 1 / window.innerWidth;

        let lightBufferIdx = 0;
        for (let i = 0; i < SdfCanvas.#trackedLights.length; i++) {
            const light = SdfCanvas.#trackedLights[i];

            if (!light.active) {
                continue;
            }

            if (!this.#containedInRenderLayers(light)) {
                continue;
            }

            if (lightBufferIdx / (SdfCanvas.VEC4_PER_LIGHT * 4) >= SdfCanvas.MAX_NUM_LIGHTS) {
                break;
            }

            const rect = light.getBoundingClientRect();
            const computedStyle = getComputedStyle(light);
            let mat = Matrix.parseMatrix(computedStyle.transform);

            const offsetX = (rect.left + rect.width * 0.5) * oneOverX;
            const offsetY = (rect.top + rect.height * 0.5) * oneOverX;
            const offsetZ = this.twoDMode ? 0 : (parseFloat(computedStyle.getPropertyValue("--z")) + mat[14]) * oneOverX;

            this.#lightBuffer[lightBufferIdx + 0] = offsetX;
            this.#lightBuffer[lightBufferIdx + 1] = offsetY;
            this.#lightBuffer[lightBufferIdx + 2] = offsetZ;

            let lightType = 0;
            switch (computedStyle.getPropertyValue("--light-type")) {
                case "point":
                    lightType = 0;
                    break;
                case "directional":
                    lightType = 1;
                    const cssValues = computedStyle.getPropertyValue('--light-direction');
                    const [dirX, dirY, dirZ] = cssValues.split(' ').map(val => parseFloat(val));

                    this.#lightBuffer[lightBufferIdx + 0] = dirX;
                    this.#lightBuffer[lightBufferIdx + 1] = dirY;
                    this.#lightBuffer[lightBufferIdx + 2] = dirZ;
                    break;
            }

            const color = SdfCanvas.#parseCSSColor(computedStyle.getPropertyValue("--diffuse-color")); // light color
            this.#lightBuffer[lightBufferIdx + 4] = color.r;
            this.#lightBuffer[lightBufferIdx + 5] = color.g;
            this.#lightBuffer[lightBufferIdx + 6] = color.b;

            this.#lightBuffer[lightBufferIdx + 8] = parseFloat(computedStyle.getPropertyValue("--light-intensity")); // intensity;
            this.#lightBuffer[lightBufferIdx + 9] = parseFloat(computedStyle.getPropertyValue("--light-radius")) * oneOverX; // radius;
            this.#lightBuffer[lightBufferIdx + 10] = lightType;
            // this.#lightBuffer[lightBufferIdx + 7] = 0;

            lightBufferIdx += SdfCanvas.VEC4_PER_LIGHT * 4;
        }

        this.#numLights = lightBufferIdx / (SdfCanvas.VEC4_PER_LIGHT * 4);
    }

    #containedInRenderLayers(element) {
        const elementRenderLayers = element.dataset.renderLayers.split(" ").map((s) => parseInt(s));
        return this.renderLayers.some(item => elementRenderLayers.includes(item));
    }

    #resizeCanvasToDisplaySize(targetWidth, targetHeight) {
        // 1. Get the pixel density of the screen (e.g., Retina screens are often 2)
        const dpr = window.devicePixelRatio || 1;

        // 2. Calculate the actual physical pixels of the display area
        const w = targetWidth !== undefined ? targetWidth : this.#canvas.clientWidth;
        const h = targetHeight !== undefined ? targetHeight : this.#canvas.clientHeight;

        const displayWidth = w * dpr;
        const displayHeight = h * dpr;

        // 3. Apply your downscale factor to determine the WebGL rendering resolution
        // (Math.max is used to prevent the canvas from ever being 0x0 pixels)
        const renderWidth = Math.max(1, Math.round(displayWidth / this.#downscaleFactorX));
        const renderHeight = Math.max(1, Math.round(displayHeight / this.#downscaleFactorY));

        // 4. If the rendering resolution changed, update the canvas and viewport
        if (this.#canvas.width !== renderWidth || this.#canvas.height !== renderHeight) {

            // This changes the internal rendering resolution (the WebGL buffer size)
            this.#canvas.width = renderWidth;
            this.#canvas.height = renderHeight;

            // The WebGL viewport MUST match the internal buffer size, 
            this.#gl.viewport(0, 0, renderWidth, renderHeight);
        }
    }
}

export { SdfCanvas }