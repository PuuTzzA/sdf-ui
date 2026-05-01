import { loadShadersFromDisk, initShaderProgram, initBuffers, injectGLSL, toGlslVec2Array } from "./helper/webgl-helper-functions.js";
import { Matrix } from "./helper/matrix.js";
import { SdfCommands } from "./sdf-commands.js";
import { SdfLayer } from "./sdf-layer.js";
import { PseudoSdfCanvas } from "./pseudo-sdf-canavs.js";

class SdfCanvas {
    // ╔══════════════════════════════════════════════════════════╗
    // ║                       Constants                          ║
    // ╚══════════════════════════════════════════════════════════╝
    static MAX_NUM_COMMANDS = 512; // maximum number of commands per canvas
    static MAX_SIZE_ELEMENT_BUFFER = 512; // number of vec4 in the buffer
    static MAX_NUM_LIGHTS = 64; // maximum number of lights per canvas 

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
    static GLYPHS_PADDING = 400; // padding that is applied to all sides of the max bounding box

    static glyphsUnpaddedHeight = this.GLYPHS_MAX_BOUNDING_BOX[1][1] - this.GLYPHS_MAX_BOUNDING_BOX[0][1];
    static glyphsUnpaddedWidth = this.GLYPHS_MAX_BOUNDING_BOX[1][0] - this.GLYPHS_MAX_BOUNDING_BOX[0][0];
    static glyphsPaddedWidth = this.glyphsUnpaddedWidth + (this.GLYPHS_PADDING * 2);

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

    /**
    * Updates the buffers (geometry, light) of all instanciated canvasses to make them ready for drawing.
    */
    static topFace = false;

    static #instantiatedCanvases = [];

    static #trackedElements = [];

    static #trackedLights = [];

    static #layers = [
        new SdfLayer(SdfCommands.SMOOTH_UNION, 30),
    ]

    static #resolveColorCtx; // to convert hsl, oklch, ... to rgba

    static #cssColorCache = new Map();

    static #intToFloatBitsBuffer = new ArrayBuffer(4);
    static #intToFloatBitsUint32View = new Uint32Array(this.#intToFloatBitsBuffer);
    static #intToFloatBitsFloat32View = new Float32Array(this.#intToFloatBitsBuffer);

    static get layers() {
        return this.#layers;
    }

    static set layers(val) {
        this.#layers = val;
        this.#updateLayers();
    }

    static addTrackedElement(element) {
        this.#trackedElements.push(element);
        this.#trackedElements.sort((a, b) => (a.layerIndex - b.layerIndex));
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
        this.#trackedElements.sort((a, b) => (a.layerIndex - b.layerIndex));
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

    /**
     * Updates the buffers (geometry, light) of all instanciated canvasses to make them ready for drawing.
     */
    static update() {
        this.#instantiatedCanvases.forEach(canvas => {
            canvas.#startUpdate();
        });

        this.#updateGeormetry();
        this.#updateLights();

        this.#instantiatedCanvases.forEach(canvas => {
            canvas.#endUpdate();
        });
    }

    static #updateGeormetry() {
        const oneOverX = 1 / window.innerWidth;
        let elementIdx = 0;
        let anySuccess = false;

        allElementsLoop:
        for (let layerIdx = 0; layerIdx < this.#layers.length; layerIdx++) {
            const layer = this.#layers[layerIdx];
            let layerOperation = layer.layerOperation;
            let smoothingFactor = layer.smoothingFactor;

            if (layer.elementsInLayer == 0) {
                continue;
            }

            anySuccess = false;
            this.#instantiatedCanvases.forEach(canvas => {
                anySuccess |= canvas.#processLayer(layerIdx, layerOperation, smoothingFactor);
            });
            if (!anySuccess) {
                break allElementsLoop;
            }

            for (let i = 0; i < layer.elementsInLayer; i++) {
                const element = SdfCanvas.#trackedElements[elementIdx++];

                if (!element.active) {
                    continue;
                }

                const elementType = element.getElementType();
                let textRects = null;

                if (elementType == SdfCommands.TEXT) {
                    element.update();
                    if (element.numLetters <= 0) { // skip empty strings
                        continue;
                    }
                    textRects = element.getWordRects();
                }

                const rect = element.getBoundingClientRect();
                const computedStyle = getComputedStyle(element);
                let mat = Matrix.parseMatrix(computedStyle.transform);

                const halfWidth = element.offsetWidth * oneOverX * 0.5;
                const halfHeight = element.offsetHeight * oneOverX * 0.5; //parseInt(computedStyle.getPropertyValue("font-size")) * oneOverX * 0.5 
                const halfDepth = parseFloat(computedStyle.getPropertyValue("--depth")) * oneOverX * 0.5;

                const offsetX = (rect.left + rect.width * 0.5) * oneOverX;
                const offsetY = (rect.top + rect.height * 0.5) * oneOverX;
                const offsetZ = parseFloat(computedStyle.getPropertyValue("--z")) * oneOverX;

                // calculate computedStyle.transform @ T(offsetX, offsetY, offsetZ)
                mat[12] = offsetX; // + mat[12] * oneOverX;
                mat[13] = offsetY; // + mat[13] * oneOverX;
                mat[14] = offsetZ + mat[14] * oneOverX; // for tx and ty this is covered by the boundingClientRect
                mat[15] = 1;

                if (this.topFace) {
                    // if I want the surface to be the top surface
                    mat[12] -= mat[8] * halfDepth;
                    mat[13] -= mat[9] * halfDepth;
                    mat[14] -= mat[10] * halfDepth;
                }
                const originalTz = mat[14]; // this is needed to compute the glyph z-positions for text

                const diffuseColor = SdfCanvas.#parseCSSColor(computedStyle.getPropertyValue("--diffuse-color"));
                const specularColor = SdfCanvas.#parseCSSColor(computedStyle.getPropertyValue("--specular-color"));
                const ambientColor = SdfCanvas.#parseCSSColor(computedStyle.getPropertyValue("--ambient-color"));
                const kd = parseFloat(computedStyle.getPropertyValue("--kd"));
                const ks = parseFloat(computedStyle.getPropertyValue("--ks"));
                const p = parseFloat(computedStyle.getPropertyValue("--p"));
                const ka = parseFloat(computedStyle.getPropertyValue("--ka"));

                const extrude = parseFloat(computedStyle.getPropertyValue("--extrude")) * oneOverX;

                // invert the matrix
                Matrix.invertAffineMat4InPlace(mat);

                anySuccess = false;
                this.#instantiatedCanvases.forEach(canvas => {
                    anySuccess |= canvas.#processElement(
                        element, rect, computedStyle, mat, halfWidth, halfHeight, halfDepth, extrude,
                        offsetX, offsetY, offsetZ, diffuseColor, specularColor, ambientColor, kd, ks, p, ka, textRects, originalTz);
                });
                if (!anySuccess) {
                    break allElementsLoop;
                }
            }
        }
    }

    static #updateLights() {
        const oneOverX = 1 / window.innerWidth;

        for (let i = 0; i < SdfCanvas.#trackedLights.length; i++) {
            const light = SdfCanvas.#trackedLights[i];

            if (!light.active) {
                continue;
            }

            const rect = light.getBoundingClientRect();
            const computedStyle = getComputedStyle(light);
            let mat = Matrix.parseMatrix(computedStyle.transform);

            let offsetX = (rect.left + rect.width * 0.5) * oneOverX;
            let offsetY = (rect.top + rect.height * 0.5) * oneOverX;
            let offsetZ = (parseFloat(computedStyle.getPropertyValue("--z")) + mat[14]) * oneOverX;

            let lightType = 0;
            switch (computedStyle.getPropertyValue("--light-type")) {
                case "point":
                    lightType = 0;
                    break;
                case "directional":
                    lightType = 1;
                    const cssValues = computedStyle.getPropertyValue('--light-direction');
                    const [dirX, dirY, dirZ] = cssValues.split(' ').map(val => parseFloat(val));

                    offsetX = dirX;
                    offsetY = dirY;
                    offsetZ = dirZ;
                    break;
            }

            const lightColor = SdfCanvas.#parseCSSColor(computedStyle.getPropertyValue("--diffuse-color")); // light color
            const lightIntensity = parseFloat(computedStyle.getPropertyValue("--light-intensity"));
            const lightRadius = parseFloat(computedStyle.getPropertyValue("--light-radius")) * oneOverX;

            let anySuccess = false;
            this.#instantiatedCanvases.forEach(canvas => {
                anySuccess |= canvas.#processLight(light, offsetX, offsetY, offsetZ, lightColor, lightIntensity, lightRadius, lightType);
            });
            if (!anySuccess) {
                break;
            }
        }
    }

    static getElementSize(element) { // in amounts of vec4s
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
            if (parseInt(e.layerIndex) == currentIdx) {
                currentNum++;
            } else {
                this.#layers[currentIdx].elementsInLayer = currentNum;
                const newLayerIdx = parseInt(e.layerIndex);

                if (newLayerIdx >= this.#layers.length) {
                    return;
                }

                for (let i = currentIdx + 1; i < newLayerIdx; i++) {
                    this.#layers[i].elementsInLayer = 0;
                }

                currentIdx = newLayerIdx;
                currentNum = 1;
            }
        });
        this.#layers[currentIdx].elementsInLayer = currentNum;

        for (let i = currentIdx + 1; i < this.#layers.length; i++) {
            this.#layers[i].elementsInLayer = 0;
        }
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

    static intToFloatBits(i) {
        this.#intToFloatBitsUint32View[0] = i;      // This uses a typed array view over buf; it does not copy memory; modifying the typed array directly modifies the underlying buffer
        return this.#intToFloatBitsFloat32View[0];  // reinterpret as float
    }

    static #parseCSSColor(css) {
        if (this.#cssColorCache.has(css)) {
            return this.#cssColorCache.get(css);
        }

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
        const resultingColor = { r: r / 255, g: g / 255, b: b / 255, a: a / 255 };

        this.#cssColorCache.set(css, resultingColor);
        return resultingColor;
    }

    // ╔══════════════════════════════════════════════════════════╗
    // ║                        SdfCanvas                         ║
    // ╚══════════════════════════════════════════════════════════╝
    #ready;
    #useBackground;
    onCompilationComplete;
    backgroundSmoothScaling;

    #canvasName;
    #canvas;
    #gl;

    // Pseudo canvases
    backgroundCanvas;
    foregroundCanvas;

    // Shared Resources
    #glyphTexture;
    #overwriteLayers;

    // FBO Resources for Background Downscaling
    #bgFramebuffer;
    #bgTexture;
    #bgWidth = 0;
    #bgHeight = 0;

    // Simple Texture Copy Shader
    #copyProgramInfo;

    // Getters and Setters
    get canvas() {
        return this.#canvas;
    }

    get ready() {
        return this.#ready;
    }

    /**
      * @param {boolean} background - (default = false) Specifies if to apply it to the foreground or background canvas. 
     */
    getDownscaleFactorX(background = false) {
        if (background) {
            return this.backgroundCanvas.downscaleFactorX;
        }
        return this.foregroundCanvas.downscaleFactorX;
    }

    /**
      * @param {number} val - new downscaleFactorX 
      * @param {boolean} background - (default = false) Specifies if to apply it to the foreground or background canvas. 
     */
    setDownscaleFactorX(val, background = false) {
        if (background) {
            this.backgroundCanvas.downscaleFactorX = val;
        } else {
            this.foregroundCanvas.downscaleFactorX = val;
        }
        if (this.#ready) {
            this.#resizeCanvasToDisplaySize();
        }
    }

    /**
     * @param {boolean} background - (default = false) Specifies if to apply it to the foreground or background canvas.
     */
    getDownscaleFactorY(background = false) {
        if (background) {
            return this.backgroundCanvas.downscaleFactorY;
        }
        return this.foregroundCanvas.downscaleFactorY;
    }

    /**
     * @param {number} val - new downscaleFactorY
     * @param {boolean} background - (default = false) Specifies if to apply it to the foreground or background canvas.
     */
    setDownscaleFactorY(val, background = false) {
        if (background) {
            this.backgroundCanvas.downscaleFactorY = val;
        } else {
            this.foregroundCanvas.downscaleFactorY = val;
        }
        if (this.#ready) {
            this.#resizeCanvasToDisplaySize();
        }
    }

    /**
     * @param {boolean} background - (default = false) Specifies if to apply it to the foreground or background canvas.
     */
    getCameraZ(background = false) {
        if (background) {
            return this.backgroundCanvas.cameraZ;
        }
        return this.foregroundCanvas.cameraZ;
    }

    /**
     * @param {number} val - new cameraZ
     * @param {boolean} background - (default = false) Specifies if to apply it to the foreground or background canvas.
     */
    setCameraZ(val, background = false) {
        if (background) {
            this.backgroundCanvas.cameraZ = val;
        } else {
            this.foregroundCanvas.cameraZ = val;
        }
    }

    /**
     * @param {boolean} background - (default = false) Specifies if to apply it to the foreground or background canvas.
     */
    getUseAA(background = false) {
        if (background) {
            return this.backgroundCanvas.useAA;
        }
        return this.foregroundCanvas.useAA;
    }

    /**
     * @param {boolean} val - new useAA
     * @param {boolean} background - (default = false) Specifies if to apply it to the foreground or background canvas.
     */
    setUseAA(val, background = false) {
        if (background) {
            this.backgroundCanvas.useAA = val;
        } else {
            this.foregroundCanvas.useAA = val;
        }
    }

    /**
     * @param {boolean} background - (default = false) Specifies if to apply it to the foreground or background canvas.
     */
    getTwoDMode(background = false) {
        if (background) {
            return this.backgroundCanvas.twoDMode;
        }
        return this.foregroundCanvas.twoDMode;
    }

    /**
     * @param {boolean} val - new twoDMode
     * @param {boolean} background - (default = false) Specifies if to apply it to the foreground or background canvas.
     */
    setTwoDMode(val, background = false) {
        if (background) {
            this.backgroundCanvas.twoDMode = val;
        } else {
            this.foregroundCanvas.twoDMode = val;
        }
    }

    /**
     * @param {boolean} background - (default = false) Specifies if to apply it to the foreground or background canvas.
     */
    getCustomShadeFunction(background = false) {
        if (background) {
            return this.backgroundCanvas.customShadeFunction;
        }
        return this.foregroundCanvas.customShadeFunction;
    }

    /**
     * @param {Function|null} val - new customShadeFunction
     * @param {boolean} background - (default = false) Specifies if to apply it to the foreground or background canvas.
     */
    setCustomShadeFunction(val, background = false) {
        if (background) {
            this.backgroundCanvas.customShadeFunction = val;
        } else {
            this.foregroundCanvas.customShadeFunction = val;
        }
    }

    /**
     * Add an overwriteLayer to the SdfCanvas. This canvas will then use this overwriteLayer's properties instead of the global SdfLayer properties.
     * @param {number} index - Index of the layer to overwrite.
     * @param {SdfLayer} overwriteLayer - SdfLayer object that overwrites that layer.
     * @param {boolean} background - (default = false) Specifies if to apply it to the foreground or background canvas. 
     */
    addOverwriteLayer(index, overwriteLayer, background = false) {
        if (background) {
            this.backgroundCanvas.addOverwriteLayer(index, overwriteLayer);
        } else {
            this.foregroundCanvas.addOverwriteLayer(index, overwriteLayer);
        }
    }

    /**
     * Removes an overwriteLayer from the SdfCanvas. 
     * @param {number} index - Index of the overwriteLayer to remove.
     * @param {boolean} background - (default = false) Specifies if to apply it to the foreground or background canvas. 
     */
    removeOverwriteLayer(index, background = false) {
        if (background) {
            this.backgroundCanvas.removeOverwriteLayer(index);
        } else {
            this.foregroundCanvas.removeOverwriteLayer(index);
        }
    }

    constructor(canvasName, options = {}) {
        SdfCanvas.#instantiatedCanvases.push(this);

        // Required and private mebers
        this.#canvasName = canvasName;
        this.#ready = false;

        this.#canvas;
        this.#gl;

        // User parameters
        const {
            onCompilationComplete = undefined,
            canvas = {},
            backgroundCanvas = undefined,
            backgroundSmoothScaling = false,
        } = options;

        this.onCompilationComplete = onCompilationComplete;
        this.foregroundCanvas = new PseudoSdfCanvas(canvas);
        if (backgroundCanvas) {
            this.#useBackground = true;
            this.backgroundCanvas = new PseudoSdfCanvas(backgroundCanvas);
        } else {
            this.#useBackground = false;
        }
        this.backgroundSmoothScaling = backgroundSmoothScaling;
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

        // Bake Glyphs
        this.#gl.getExtension('EXT_color_buffer_float');
        this.#gl.getExtension('OES_texture_float_linear');

        const textureSetupPromise = (async () => {
            this.#glyphTexture = await SdfCanvas.#bakeLetterSdfs(this.#gl);
        })();

        // Continue with the rest of the setup
        let { vertexSource, fragmentSource } = await loadShadersFromDisk("vertex.glsl", "fragment.glsl");
        let fgProgramInfo;

        if (this.#useBackground) {
            // Setup Framebuffer for Background
            this.#bgTexture = this.#gl.createTexture();
            this.#gl.bindTexture(this.#gl.TEXTURE_2D, this.#bgTexture);

            const filterMode = this.backgroundSmoothScaling ? this.#gl.LINEAR : this.#gl.NEAREST;

            this.#gl.texParameteri(this.#gl.TEXTURE_2D, this.#gl.TEXTURE_MIN_FILTER, filterMode);
            this.#gl.texParameteri(this.#gl.TEXTURE_2D, this.#gl.TEXTURE_MAG_FILTER, filterMode);

            this.#gl.texParameteri(this.#gl.TEXTURE_2D, this.#gl.TEXTURE_WRAP_S, this.#gl.CLAMP_TO_EDGE);
            this.#gl.texParameteri(this.#gl.TEXTURE_2D, this.#gl.TEXTURE_WRAP_T, this.#gl.CLAMP_TO_EDGE);

            this.#bgFramebuffer = this.#gl.createFramebuffer();
            this.#gl.bindFramebuffer(this.#gl.FRAMEBUFFER, this.#bgFramebuffer);
            this.#gl.framebufferTexture2D(this.#gl.FRAMEBUFFER, this.#gl.COLOR_ATTACHMENT0, this.#gl.TEXTURE_2D, this.#bgTexture, 0);
            this.#gl.bindFramebuffer(this.#gl.FRAMEBUFFER, null);

            // Compile Main Shaders
            let bgProgramInfo;
            if (this.backgroundCanvas.sameShaders(this.foregroundCanvas)) {
                // Compile ONCE
                const program = await this.#compileMainShader(vertexSource, fragmentSource, this.backgroundCanvas);
                bgProgramInfo = this.#createProgramInfo(program);
                fgProgramInfo = bgProgramInfo;
            } else {
                // Compile TWICE
                const bgProgram = await this.#compileMainShader(vertexSource, fragmentSource, this.backgroundCanvas);
                const fgProgram = await this.#compileMainShader(vertexSource, fragmentSource, this.foregroundCanvas);
                bgProgramInfo = this.#createProgramInfo(bgProgram);
                fgProgramInfo = this.#createProgramInfo(fgProgram);
            }

            // Initialize Background WebGL objects
            this.backgroundCanvas.initLayerWebgl(this.#gl, bgProgramInfo);

            // 4. Compile Simple Copy Shader (For rendering FBO to screen)
            const copyVert = `#version 300 es
                in vec2 aVertexPosition; 
                in vec2 aVertexUv; 
                out vec2 vUv;
                void main() { 
                    vUv = vec2(aVertexUv.x, 1.0 - aVertexUv.y); 
                    gl_Position = vec4(aVertexPosition, 0.0, 1.0); 
                }`;
            const copyFrag = `#version 300 es
                precision mediump float; 
                in vec2 vUv; 
                out vec4 fragColor; 
                uniform sampler2D uTex;
                void main() { 
                    fragColor = texture(uTex, vUv); 
                }`;

            const copyProgram = await initShaderProgram(this.#gl, copyVert, copyFrag);
            this.#copyProgramInfo = {
                program: copyProgram,
                attribLocations: {
                    vertexPosition: this.#gl.getAttribLocation(copyProgram, "aVertexPosition"),
                    vertexUv: this.#gl.getAttribLocation(copyProgram, "aVertexUv"),
                },
                uniformLocations: { uTex: this.#gl.getUniformLocation(copyProgram, "uTex") }
            };
        } else {
            // ONLY Compile Foreground Shader
            const fgProgram = await this.#compileMainShader(vertexSource, fragmentSource, this.foregroundCanvas);
            fgProgramInfo = this.#createProgramInfo(fgProgram);
        }

        // Initialize Foreground WebGL
        this.foregroundCanvas.initLayerWebgl(this.#gl, fgProgramInfo);

        // Window resize
        window.addEventListener("resize", () => {
            this.#resizeCanvasToDisplaySize();
            this.draw();
        });

        await textureSetupPromise;
        this.#resizeCanvasToDisplaySize();

        if (this.onCompilationComplete) {
            this.onCompilationComplete();
        }
        this.#ready = true;
        return true;
    }

    async #compileMainShader(baseVertex, baseFragment, layerObj) {
        let defines = "";
        if (layerObj.twoDMode) {
            defines += "#define TWO_D_MODE\n";
        }
        if (layerObj.useAA) {
            defines += "#define AA\n";
        }
        if (layerObj.customShadeFunction != "") {
            defines += "#define CUSTOM_SHADE_FUNCTION\n";
            baseFragment = injectGLSL(baseFragment, "SHADE_FUNCTION", layerObj.customShadeFunction);
        }
        baseFragment = injectGLSL(baseFragment, "DEFINES", defines);

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
        layerObj.lastCustomIdx = Math.min(SdfCommands.CUSTOM_START + SdfCanvas.customElements.length - 1, SdfCommands.CUSTOM_END);

        baseFragment = injectGLSL(baseFragment, "CUSTOM_ELEMENTS_FUNCTIONS", functionString);
        baseFragment = injectGLSL(baseFragment, "CUSTOM_ELEMENTS_COMMANDS", commandString);

        return await initShaderProgram(this.#gl, baseVertex, baseFragment);
    }

    #createProgramInfo(program) {
        return {
            program: program,
            attribLocations: {
                vertexPosition: 0,
                vertexUv: this.#gl.getAttribLocation(program, "aVertexUv"),
            },
            uniformLocations: {
                resolution: this.#gl.getUniformLocation(program, "uResolution"),
                top: this.#gl.getUniformLocation(program, "uTopOffset"),
                left: this.#gl.getUniformLocation(program, "uLeftOffset"),
                width: this.#gl.getUniformLocation(program, "uWindowWidth"),
                height: this.#gl.getUniformLocation(program, "uWindowHeight"),
                cameraZ: this.#gl.getUniformLocation(program, "uCameraZ"),
                twoDMode: this.#gl.getUniformLocation(program, "uTwoDMode"),
                numCommands: this.#gl.getUniformLocation(program, "uNumCommands"),
                numLights: this.#gl.getUniformLocation(program, "uNumLights"),
                commandBlock: this.#gl.getUniformBlockIndex(program, "CommandBlock"),
                geometryBlock: this.#gl.getUniformBlockIndex(program, "GeometryBlock"),
                shadingBlock: this.#gl.getUniformBlockIndex(program, "ShadingBlock"),
                lightBlock: this.#gl.getUniformBlockIndex(program, "LightBlock"),

                // Uniforms for the Glyph Texture
                sdfArray: this.#gl.getUniformLocation(program, 'uSdfArray'),
                boxMin: this.#gl.getUniformLocation(program, "uBoxMin"),
                boxMax: this.#gl.getUniformLocation(program, "uBoxMax"),
            },
        };
    }

    /**
     * Renders the WebGL scene by first drawing the background (if one was defined)
     * and then the foreground. If a background was defined, you should also define the
     * scissor method of this method, since otherwise the whole background will be 
     * overwritten.
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
        if (!this.#ready) return;

        const gl = this.#gl;

        // Setup Global State
        gl.disable(gl.SCISSOR_TEST);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);

        // Bind Shared Texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.#glyphTexture);

        if (this.#useBackground) {
            // render background to offscreen FBO
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.#bgFramebuffer);
            gl.viewport(0, 0, this.#bgWidth, this.#bgHeight);

            gl.clearColor(0.0, 0.0, 0.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

            this.#drawLayer(this.backgroundCanvas);

            // copy to main canvas 
            gl.bindFramebuffer(gl.FRAMEBUFFER, null); // Draw to Screen
            gl.viewport(0, 0, this.#canvas.width, this.#canvas.height);

            gl.clearColor(0.0, 0.0, 0.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

            gl.useProgram(this.#copyProgramInfo.program);
            gl.bindVertexArray(this.backgroundCanvas.buffers.vao); // Reuse a VAO for quad positions

            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.#bgTexture);
            gl.uniform1i(this.#copyProgramInfo.uniformLocations.uTex, 1);

            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        } else {
            // just clear the screen
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, this.#canvas.width, this.#canvas.height);
            gl.clearColor(0.0, 0.0, 0.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        }

        // foreground 
        if (scissor) {
            gl.enable(gl.SCISSOR_TEST);

            const scaleX = this.#canvas.width / this.#canvas.clientWidth;
            const scaleY = this.#canvas.height / this.#canvas.clientHeight;

            const rect = this.#canvas.getBoundingClientRect();
            const localX = scissor.x - rect.left;
            const localY = scissor.y - rect.top;

            const sx = localX * scaleX;
            const sy = this.#canvas.height - ((localY + scissor.h) * scaleY); // webgl Y is bottom-up
            const sw = scissor.w * scaleX;
            const sh = scissor.h * scaleY;


            gl.scissor(sx, sy, sw, sh);
        }

        // Reactivate SDF texture for foreground on TEXTURE0 (in case background used TEXTURE1 for copy)
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.#glyphTexture);

        this.#drawLayer(this.foregroundCanvas);

        if (scissor) {
            gl.disable(gl.SCISSOR_TEST);
        }
    }

    #drawLayer(layer) {
        const gl = this.#gl;
        const progInfo = layer.programInfo;
        const bufs = layer.buffers;

        gl.useProgram(progInfo.program);
        gl.bindVertexArray(bufs.vao);

        // Update Uniforms
        gl.uniform1i(progInfo.uniformLocations.sdfArray, 0);
        gl.uniform2f(progInfo.uniformLocations.boxMin, SdfCanvas.GLYPHS_MAX_BOUNDING_BOX[0][0] - SdfCanvas.GLYPHS_PADDING, SdfCanvas.GLYPHS_MAX_BOUNDING_BOX[0][1] - SdfCanvas.GLYPHS_PADDING);
        gl.uniform2f(progInfo.uniformLocations.boxMax, SdfCanvas.GLYPHS_MAX_BOUNDING_BOX[1][0] + SdfCanvas.GLYPHS_PADDING, SdfCanvas.GLYPHS_MAX_BOUNDING_BOX[1][1] + SdfCanvas.GLYPHS_PADDING);

        gl.uniform2f(progInfo.uniformLocations.resolution, window.innerWidth, window.innerHeight);

        const rect = this.#canvas.getBoundingClientRect();
        gl.uniform1f(progInfo.uniformLocations.top, rect.top / window.innerWidth);
        gl.uniform1f(progInfo.uniformLocations.left, rect.left / window.innerWidth);
        gl.uniform1f(progInfo.uniformLocations.width, (rect.right - rect.left) / window.innerWidth);
        gl.uniform1f(progInfo.uniformLocations.height, (rect.bottom - rect.top) / window.innerWidth);

        gl.uniform1f(progInfo.uniformLocations.cameraZ, layer.cameraZ);

        gl.uniform1i(progInfo.uniformLocations.numCommands, layer.numCommands);
        gl.uniform1i(progInfo.uniformLocations.numLights, layer.numLights);

        // Upload Data Buffers
        gl.bindBufferBase(gl.UNIFORM_BUFFER, SdfCanvas.COMMAND_BLOCK_UNIFORM_BUFFER_BINDING_INDEX, bufs.commandBuffer);
        gl.bufferSubData(gl.UNIFORM_BUFFER, 0, layer.commandBuffer);

        gl.bindBufferBase(gl.UNIFORM_BUFFER, SdfCanvas.GEOMETRY_BLOCK_UNIFORM_BUFFER_BINDING_INDEX, bufs.geometryBuffer);
        gl.bufferSubData(gl.UNIFORM_BUFFER, 0, layer.geometryBuffer);

        gl.bindBufferBase(gl.UNIFORM_BUFFER, SdfCanvas.SHADING_BLOCK_UNIFORM_BUFFER_BINDING_INDEX, bufs.shadingBuffer);
        gl.bufferSubData(gl.UNIFORM_BUFFER, 0, layer.shadingBuffer);

        gl.bindBufferBase(gl.UNIFORM_BUFFER, SdfCanvas.LIGHT_BLOCK_UNIFORM_BUFFER_BINDING_INDEX, bufs.lightBuffer);
        gl.bufferSubData(gl.UNIFORM_BUFFER, 0, layer.lightBuffer);

        // Draw quad
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    #resizeCanvasToDisplaySize() {
        const dpr = window.devicePixelRatio || 1; // Pixel density of the screen (e.g., Retina screens are often 2)
        const displayWidth = this.#canvas.clientWidth * dpr;
        const displayHeight = this.#canvas.clientHeight * dpr;

        // Main Canvas (Foreground Resolution)
        const renderWidth = Math.max(1, Math.round(displayWidth / (this.foregroundCanvas.downscaleFactorX * dpr)));
        const renderHeight = Math.max(1, Math.round(displayHeight / (this.foregroundCanvas.downscaleFactorY * dpr)));

        if (this.#canvas.width !== renderWidth || this.#canvas.height !== renderHeight) {
            this.#canvas.width = renderWidth;
            this.#canvas.height = renderHeight;
        }

        // Background FBO Texture (Background Resolution)
        if (this.#useBackground) {
            const bgWidth = Math.max(1, Math.round(displayWidth / (this.backgroundCanvas.downscaleFactorX * dpr)));
            const bgHeight = Math.max(1, Math.round(displayHeight / (this.backgroundCanvas.downscaleFactorY * dpr)));

            if (this.#bgWidth !== bgWidth || this.#bgHeight !== bgHeight) {
                this.#bgWidth = bgWidth;
                this.#bgHeight = bgHeight;

                // Reallocate texture memory at new resolution
                this.#gl.bindTexture(this.#gl.TEXTURE_2D, this.#bgTexture);
                this.#gl.texImage2D(this.#gl.TEXTURE_2D, 0, this.#gl.RGBA, bgWidth, bgHeight, 0, this.#gl.RGBA, this.#gl.UNSIGNED_BYTE, null);
            }
        }
    }

    #startUpdate() {
        this.foregroundCanvas.startUpdate();
        if (this.#useBackground) {
            this.backgroundCanvas.startUpdate();
        }
    }

    #processLayer(layerIdx, layerOperation, smoothingFactor) {
        if (!this.#ready) {
            return false;
        }
        let success = this.foregroundCanvas.processLayer(layerIdx, layerOperation, smoothingFactor);
        if (this.#useBackground) {
            success |= this.backgroundCanvas.processLayer(layerIdx, layerOperation, smoothingFactor);
        }
        return success;
    }

    #processElement(element, rect, computedStyle, mat, halfWidth, halfHeight, halfDepth, extrude, offsetX, offsetY, offsetZ, diffuseColor, specularColor, ambientColor, kd, ks, p, ka, textRects, originalTz) {
        if (!this.#ready) {
            return false;
        }
        let success = this.foregroundCanvas.processElement(element, rect, computedStyle, mat, halfWidth, halfHeight, halfDepth, extrude, offsetX, offsetY, offsetZ, diffuseColor, specularColor, ambientColor, kd, ks, p, ka, textRects, originalTz);
        if (this.#useBackground) {
            success |= this.backgroundCanvas.processElement(element, rect, computedStyle, mat, halfWidth, halfHeight, halfDepth, extrude, offsetX, offsetY, offsetZ, diffuseColor, specularColor, ambientColor, kd, ks, p, ka, textRects, originalTz);
        }
        return success;
    }

    #processLight(light, offsetX, offsetY, offsetZ, lightColor, lightIntensity, lightRadius, lightType) {
        if (!this.#ready) {
            return false;
        }
        let success = this.foregroundCanvas.processLight(light, offsetX, offsetY, offsetZ, lightColor, lightIntensity, lightRadius, lightType);
        if (this.#useBackground) {
            success |= this.backgroundCanvas.processLight(light, offsetX, offsetY, offsetZ, lightColor, lightIntensity, lightRadius, lightType);
        }
        return success;
    }

    #endUpdate() {
        this.foregroundCanvas.endUpdate();
        if (this.#useBackground) {
            this.backgroundCanvas.endUpdate();
        }
    }
}

export { SdfCanvas }