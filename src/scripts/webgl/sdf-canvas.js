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
    static MAX_SIZE_ELEMENT_BUFFER = 512; // number of vec4 in the buffer

    static MAX_LAYERS = 16;

    static GEOMETRY_BLOCK_UNIFORM_BUFFER_BINDING_INDEX = 0;
    static SHADING_BLOCK_UNIFORM_BUFFER_BINDING_INDEX = 1;

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

        if (this.trackedElementsSize + size > SdfCanvas.MAX_SIZE_ELEMENT_BUFFER) {
            console.error(f`Cannot track more elemtns than the maximum amount (${SdfCanvas.MAX_SIZE_ELEMENT_BUFFER}).`);
        }

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

    static updateTrackedElementSize(element, oldSize, newSize) {
        // This method is only important for elements with variable size (e.g. TEXT)
        if (this.trackedElementsSize - oldSize + newSize > SdfCanvas.MAX_SIZE_ELEMENT_BUFFER) {
            console.error(f`ERROR: cannot increse the size of ${element} from ${oldSize} to ${newSize}. Current total size: ${this.trackedElementsSize}, max size: ${SdfCanvas.MAX_SIZE_ELEMENT_BUFFER}.`);
            return oldSize;
        }
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

    constructor(canvasName, renderLayers = [0]) {
        SdfCanvas.instantiatedCanvases.push(this);

        this.canvasName = canvasName;
        this.renderLayers = renderLayers;
        this.ready = false;
        this.downscaleFactorX = 1;
        this.downscaleFactorY = 10;

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

        this.resizeCanvasToDisplaySize();

        // Set clear color to black, fully opaque
        this.gl.clearColor(0.0, 0.0, 0.0, 1.0);
        // Clear the color buffer with specified clear color
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);

        console.log("before loading shaders from disk")
        const { vertexSource, fragmentSource } = await SdfCanvas.loadShadersFromDisk();

        console.log("after loading shaders from disk")
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
        let elementIdx = 0;
        const range = document.createRange(); // to get a bounding box of text elements

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
                    element.updateSize();
                    const numLetters = element.getNumberOfLetters();
                    const letterScale = 450 / halfHeight; // 450 because 450 = 900 / 2 and halfHeight has the implicit 0.5 * ...
                    this.geometryBuffer[elementIdx + 13] = SdfCanvas.intToFloatBits(numLetters); // amount of letters
                    this.geometryBuffer[elementIdx + 14] = letterScale; // letter scale 
                    this.geometryBuffer[elementIdx + 15] = halfDepth; // depth 

                    this.geometryBuffer[elementIdx + 16] = Math.max(parseFloat(computedStyle.getPropertyValue("--letterSmoothness")) * oneOverX, 0.0001); // smoothness between letters (this memory location always exists, since TEXT-elements with 0 letters are skipped)
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
                        const wordBottomEdgeLocalY = -halfHeight;

                        for (let currentLetterIdx = 0; currentLetterIdx < currentWord[0].length; currentLetterIdx++) {
                            let currentSubstringWidth = element.measure(currentText.substring(0, currentLetterIdx)) * oneOverX;
                            const currentLetterCode = currentText.charCodeAt(currentLetterIdx);
                            if (currentLetterCode == 't'.charCodeAt(0)) {
                                currentSubstringWidth += 45 / 2 / letterScale// * oneOverX;
                            }

                            this.geometryBuffer[elementIdx + 20 + letterIdx * 4 + 0] = -wordCenterLocal[0] - (wordLeftEdgeLocalX + currentSubstringWidth); // offsetX
                            this.geometryBuffer[elementIdx + 20 + letterIdx * 4 + 1] = -wordCenterLocal[1] - wordBottomEdgeLocalY; // offsetY
                            this.geometryBuffer[elementIdx + 20 + letterIdx * 4 + 2] = -wordCenterLocal[2]; // offsetZ
                            this.geometryBuffer[elementIdx + 20 + letterIdx * 4 + 3] = SdfCanvas.intToFloatBits(currentLetterCode); // letterCode
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