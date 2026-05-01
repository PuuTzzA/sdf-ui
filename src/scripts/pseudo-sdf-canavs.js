import { SdfCanvas } from "./sdf-canvas.js";
import { BitMask } from "./helper/bitmask.js";
import { initBuffers } from "./helper/webgl-helper-functions.js";
import { SdfCommands } from "./sdf-commands.js";
import { Matrix } from "./helper/matrix.js";

class PseudoSdfCanvas {
    #renderLayers;
    downscaleFactorX;
    downscaleFactorY;
    cameraZ;
    useAA;
    twoDMode;
    customShadeFunction;
    #bitmask;
    #overwriteLayers;

    // Layer-specific data buffers
    numCommands = 0;
    numLights = 0;
    commandBuffer;
    geometryBuffer;
    shadingBuffer;
    lightBuffer;
    #commandBufferIdx;
    #geometryBufferIdx;
    #lightBufferIdx;

    // WebGL objects populated during init
    programInfo;
    buffers;

    // getter and setter
    get renderLayers() {
        return this.#renderLayers;
    }

    set renderLayers(val) {
        this.#renderLayers = val;
        this.#bitmask.updateArray(val);
    }

    constructor(options = {}) {
        const {
            renderLayers = [0],
            downscaleFactorX = 2,
            downscaleFactorY = 2,
            cameraZ = 10,
            useAA = false,
            twoDMode = false,
            customShadeFunction = "",
        } = options;

        this.#renderLayers = renderLayers;
        this.#bitmask = new BitMask(this.#renderLayers);
        this.downscaleFactorX = downscaleFactorX;
        this.downscaleFactorY = downscaleFactorY;
        this.#overwriteLayers = new Map();

        this.cameraZ = cameraZ;
        this.useAA = useAA;
        this.twoDMode = twoDMode;
        this.customShadeFunction = customShadeFunction;

        // Initialize JavaScript typed arrays for this specific layer
        this.commandBuffer = new Int32Array(SdfCanvas.MAX_NUM_COMMANDS * 4);
        this.geometryBuffer = new Float32Array(SdfCanvas.MAX_SIZE_ELEMENT_BUFFER * 4);
        this.shadingBuffer = new Float32Array(SdfCanvas.MAX_SIZE_ELEMENT_BUFFER * 4);
        this.lightBuffer = new Float32Array(SdfCanvas.MAX_NUM_LIGHTS * SdfCanvas.VEC4_PER_LIGHT * 4);
    }

    sameShaders(other) {
        return this.useAA == other.useAA
            && this.twoDMode == other.twoDMode
            && this.customShadeFunction == other.customShadeFunction;
    }

    /**
     * Initializes the WebGL buffers specific to this layer.
     */
    initLayerWebgl(gl, programInfo) {
        this.programInfo = programInfo;
        // Uses your existing helper function. 
        // Note: This creates a VAO and UBOs specific to this layer.
        this.buffers = initBuffers(gl, this.programInfo);
    }

    addOverwriteLayer(index, overwriteLayer) {
        this.#overwriteLayers.set(index, overwriteLayer);
    }

    removeOverwriteLayer(index) {
        if (!this.#overwriteLayers.has(index)) {
            return;
        }
        this.#overwriteLayers.delete(index);
    }

    startUpdate() {
        this.#commandBufferIdx = 0;
        this.#geometryBufferIdx = 0;
        this.#lightBufferIdx = 0;
    }

    processLayer(layerIdx, layerOperation, smoothingFactor) {
        const oneOverX = 1 / window.innerWidth;

        if (this.#overwriteLayers.has(layerIdx)) {
            const overwriteLayer = this.#overwriteLayers.get(layerIdx);
            layerOperation = overwriteLayer.layerOperation;
            smoothingFactor = overwriteLayer.smoothingFactor;
        }

        if (!this.#addToCommandBufferIfSize(SdfCommands.SET_LAYER_DATA, 1)) {
            return false;
        };

        this.geometryBuffer[this.#geometryBufferIdx] = SdfCanvas.intToFloatBits(layerOperation);
        this.geometryBuffer[this.#geometryBufferIdx + 1] = smoothingFactor * oneOverX;
        this.#geometryBufferIdx += 4;
        return true;
    }

    processElement(element, rect, computedStyle, mat, halfWidth, halfHeight, halfDepth, extrude, offsetX, offsetY, offsetZ, diffuseColor, specularColor, ambientColor, kd, ks, p, ka, textRects, originalTz) {
        if (!this.#containedInRenderLayers(element)) {
            return true;
        }

        if (!this.#addToCommandBufferIfSize(SdfCommands.LOAD_ELEMENT_MATRIX_AND_MATERIAL, 3)) {
            return false;
        };

        if (this.twoDMode) {
            halfDepth = 100;
        }

        const oneOverX = 1 / window.innerWidth;
        const elementType = element.getElementType();
        const savedGeometryBufferIdx = this.#geometryBufferIdx;

        // Inverse affine modelview matrix = computedStyle.transform @ T(offsetX, offsetY, offsetZ), computedStyle.transform used without translation since that is already in boundingclientrect
        this.#storeMat4InGeometryBuffer(mat, this.#geometryBufferIdx);

        if (this.twoDMode) {
            this.geometryBuffer[this.#geometryBufferIdx + 11] = 0; // translation z
        }

        // Shading Information
        this.shadingBuffer[this.#geometryBufferIdx + 0] = diffuseColor.r;
        this.shadingBuffer[this.#geometryBufferIdx + 1] = diffuseColor.g;
        this.shadingBuffer[this.#geometryBufferIdx + 2] = diffuseColor.b;
        this.shadingBuffer[this.#geometryBufferIdx + 3] = kd; // diffuse material property

        this.shadingBuffer[this.#geometryBufferIdx + 4] = specularColor.r;
        this.shadingBuffer[this.#geometryBufferIdx + 5] = specularColor.g;
        this.shadingBuffer[this.#geometryBufferIdx + 6] = specularColor.b;
        this.shadingBuffer[this.#geometryBufferIdx + 7] = ks; // specular material property

        this.shadingBuffer[this.#geometryBufferIdx + 8] = p; // specular exponent

        this.shadingBuffer[this.#geometryBufferIdx + 12] = ambientColor.r;
        this.shadingBuffer[this.#geometryBufferIdx + 13] = ambientColor.g;
        this.shadingBuffer[this.#geometryBufferIdx + 14] = ambientColor.b;
        this.shadingBuffer[this.#geometryBufferIdx + 15] = ka; // ambient material property

        this.#geometryBufferIdx += 4 * 4;

        // Add modifiers
        if (!this.#processModifiers(element, elementType, computedStyle, savedGeometryBufferIdx)) {
            return false;
        };

        const savedCommandBufferIdx = this.#commandBufferIdx;
        if (!this.#addToCommandBufferIfSize(elementType, SdfCanvas.getElementSize(element))) {
            return false;
        };

        // Element specific data
        switch (elementType) {
            case SdfCommands.SPHERE:
                this.geometryBuffer[this.#geometryBufferIdx + 0] = parseFloat(computedStyle.getPropertyValue("--r")) * oneOverX * 0.5; // radius 
                break;
            case SdfCommands.BOX_SIMPLE:
                this.geometryBuffer[this.#geometryBufferIdx + 0] = halfWidth; // width 
                this.geometryBuffer[this.#geometryBufferIdx + 1] = halfHeight; // height 
                this.geometryBuffer[this.#geometryBufferIdx + 2] = halfDepth; // depth
                this.geometryBuffer[this.#geometryBufferIdx + 3] = extrude; // rounding
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
                        this.#storeMat4InGeometryBuffer(mat, savedGeometryBufferIdx);

                        const temp = w;
                        w = d;
                        d = temp;
                        break;
                    case "y":
                        Matrix.mat4TimesMat4InPlace(Matrix.rotation90DegX, mat);
                        this.#storeMat4InGeometryBuffer(mat, savedGeometryBufferIdx);

                        const temp2 = h;
                        h = d;
                        d = temp2;
                        break;
                }

                this.geometryBuffer[this.#geometryBufferIdx + 0] = w; // width 
                this.geometryBuffer[this.#geometryBufferIdx + 1] = h; // height 
                this.geometryBuffer[this.#geometryBufferIdx + 2] = d; // depth
                this.geometryBuffer[this.#geometryBufferIdx + 3] = 0; // still unused

                this.geometryBuffer[this.#geometryBufferIdx + 4] = parseFloat(computedStyle.borderBottomRightRadius) * oneOverX;
                this.geometryBuffer[this.#geometryBufferIdx + 5] = parseFloat(computedStyle.borderTopRightRadius) * oneOverX;
                this.geometryBuffer[this.#geometryBufferIdx + 6] = parseFloat(computedStyle.borderBottomLeftRadius) * oneOverX;
                this.geometryBuffer[this.#geometryBufferIdx + 7] = parseFloat(computedStyle.borderTopLeftRadius) * oneOverX;

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

                this.geometryBuffer[this.#geometryBufferIdx + 8] = SdfCanvas.intToFloatBits(borderType); // border radius
                this.geometryBuffer[this.#geometryBufferIdx + 9] = extrude; // rounding
                break;
            case SdfCommands.TEXT:
                // The text expects an array of letters where the x,y,z position is at the same place as the origin of the letters in "glyph-space"
                // The scale is how big the texture is in world space (including padding), send inverse scale so that we can multiply by it to get to glyph-space 
                const letterHeight = element.measureHeight(textRects[0][0]) * oneOverX;
                const glpyhSpaceScale = letterHeight / SdfCanvas.glyphsUnpaddedHeight; // how much one unit of "glyph-space" is in world-space 
                this.geometryBuffer[this.#geometryBufferIdx + 0] = SdfCanvas.intToFloatBits(element.numLetters); // amount of letters
                this.geometryBuffer[this.#geometryBufferIdx + 1] = 1 / (SdfCanvas.glyphsPaddedWidth * glpyhSpaceScale); // inverse letter scale 
                this.geometryBuffer[this.#geometryBufferIdx + 2] = halfDepth; // depth 
                this.geometryBuffer[this.#geometryBufferIdx + 3] = Math.max(parseFloat(computedStyle.getPropertyValue("--letterSmoothness")) * oneOverX, 0.0001); // smoothness between letters

                let inverseMat3 = Matrix.extractMat3FromMat4(mat);
                let wordCenterLocal = new Float32Array(3);
                let referenceX, referenceY, referenceZ = 0;

                let letterIdx = 0;
                let globalWordTOffset = 0;
                textOuterLoop:
                for (const [currentText, currentRect] of textRects) {
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
                    const wordTOffset = currentText.charAt(0) == "t" ? -22.5 * glpyhSpaceScale : 0;

                    for (let currentLetterIdx = 0; currentLetterIdx < currentText.length; currentLetterIdx++) {
                        let currentSubstringWidth = element.measure(currentText.substring(0, currentLetterIdx)) * oneOverX;
                        const currentLetter = currentText.charAt(currentLetterIdx);
                        if (currentLetter == "t") {
                            currentSubstringWidth += 22.5 * glpyhSpaceScale;// * oneOverX;
                        }
                        if (letterIdx == 0) {
                            globalWordTOffset = currentText.charAt(0) == "t" ? -22.5 * glpyhSpaceScale : 0;
                        } else {
                            currentSubstringWidth += globalWordTOffset;
                        }

                        if (letterIdx == 0) {
                            // the first letter is the reference point and for all the other letters an offset to the first one is stored
                            this.geometryBuffer[savedGeometryBufferIdx + 9] = -wordCenterLocal[0] - (wordLeftEdgeLocalX + currentSubstringWidth);; // tx, column 4 [tx, ty, tz, 1]^T
                            this.geometryBuffer[savedGeometryBufferIdx + 10] = -wordCenterLocal[1] - letterHeight * 0.5 - SdfCanvas.GLYPHS_MAX_BOUNDING_BOX[0][1] * glpyhSpaceScale;// ty
                            this.geometryBuffer[savedGeometryBufferIdx + 11] = -wordCenterLocal[2]; // tz

                            this.geometryBuffer[this.#geometryBufferIdx + 4 + letterIdx * 4 + 0] = extrude; // rounding
                            this.geometryBuffer[this.#geometryBufferIdx + 4 + letterIdx * 4 + 1] = 0; // still unused
                            this.geometryBuffer[this.#geometryBufferIdx + 4 + letterIdx * 4 + 2] = 0; // still unused

                            referenceX = wordCenterLocal[0] + wordLeftEdgeLocalX;
                            referenceY = wordCenterLocal[1];
                            referenceZ = wordCenterLocal[2];
                        } else {
                            const difx = wordCenterLocal[0] + wordLeftEdgeLocalX - referenceX;
                            const dify = wordCenterLocal[1] - referenceY;
                            const difz = wordCenterLocal[2] - referenceZ; // should be 0

                            this.geometryBuffer[this.#geometryBufferIdx + 4 + letterIdx * 4 + 0] = - (difx + currentSubstringWidth); // offsetX
                            this.geometryBuffer[this.#geometryBufferIdx + 4 + letterIdx * 4 + 1] = - dify; // offsetY
                            this.geometryBuffer[this.#geometryBufferIdx + 4 + letterIdx * 4 + 2] = - difz; // offsetZ
                        }
                        this.geometryBuffer[this.#geometryBufferIdx + 4 + letterIdx * 4 + 3] = SdfCanvas.intToFloatBits(SdfCanvas.getCharIndex(currentLetter)); // letterCode
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
                this.geometryBuffer[this.#geometryBufferIdx + 0] = radius;
                this.geometryBuffer[this.#geometryBufferIdx + 1] = height;
                this.geometryBuffer[this.#geometryBufferIdx + 2] = extrude; // rounding
                this.geometryBuffer[this.#geometryBufferIdx + 3] = 0;
                break;
            case SdfCommands.TRIANGLE:
                const aValues = computedStyle.getPropertyValue('--point-a');
                const [aX, aY] = aValues.split(' ').map(val => parseFloat(val));

                const bValues = computedStyle.getPropertyValue('--point-b');
                const [bX, bY] = bValues.split(' ').map(val => parseFloat(val));

                const cValues = computedStyle.getPropertyValue('--point-c');
                const [cX, cY] = cValues.split(' ').map(val => parseFloat(val));

                this.geometryBuffer[this.#geometryBufferIdx + 0] = aX * oneOverX;
                this.geometryBuffer[this.#geometryBufferIdx + 1] = aY * oneOverX;
                this.geometryBuffer[this.#geometryBufferIdx + 2] = bX * oneOverX;
                this.geometryBuffer[this.#geometryBufferIdx + 3] = bY * oneOverX;

                this.geometryBuffer[this.#geometryBufferIdx + 4] = cX * oneOverX;
                this.geometryBuffer[this.#geometryBufferIdx + 5] = cY * oneOverX;
                this.geometryBuffer[this.#geometryBufferIdx + 6] = halfDepth;
                this.geometryBuffer[this.#geometryBufferIdx + 7] = extrude; // rounding
                break;
            case SdfCommands.CUSTOM:
                const elementIdx = Math.max(Math.min(SdfCommands.CUSTOM_START + element.customIndex, this.lastCustomIdx), SdfCommands.CUSTOM_START);
                this.commandBuffer[savedCommandBufferIdx] = elementIdx; // clamped to the appropriate range

                this.geometryBuffer[this.#geometryBufferIdx + 0] = 1 / (parseFloat(computedStyle.getPropertyValue("--scale")) * oneOverX);
                this.geometryBuffer[this.#geometryBufferIdx + 1] = halfDepth;
                this.geometryBuffer[this.#geometryBufferIdx + 2] = extrude; // rounding
                break;
        }
        this.#geometryBufferIdx += SdfCanvas.getElementSize(element) * 4;
        return true;
    }

    #processModifiers(element, elementType, computedStyle, savedGeometryBufferIdx) {
        const modifiers = element.modifiers;
        const oneOverX = 1 / window.innerWidth;
        for (let modifierIdx = 0; modifierIdx < modifiers.length; modifierIdx++) {
            const modifier = modifiers[modifierIdx];
            const modifierType = modifier.getModifierType();

            if (!this.#addToCommandBufferIfSize(modifierType, modifier.getModifierSize())) {
                return false;
            };

            let targetOffsetX = 0;
            let targetOffsetY = 0;
            let targetOffsetZ = 0;

            if (modifier.target != null) {
                targetOffsetX = this.geometryBuffer[savedGeometryBufferIdx + 9];
                targetOffsetY = this.geometryBuffer[savedGeometryBufferIdx + 10];
                targetOffsetZ = this.geometryBuffer[savedGeometryBufferIdx + 11];

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
                    this.geometryBuffer[this.#geometryBufferIdx + 0] = targetOffsetX; // ofset
                    this.geometryBuffer[this.#geometryBufferIdx + 1] = targetOffsetY; // ofset
                    this.geometryBuffer[this.#geometryBufferIdx + 2] = targetOffsetZ; // ofset
                    this.geometryBuffer[this.#geometryBufferIdx + 3] = modifier.amount / oneOverX; // amount

                    this.geometryBuffer[this.#geometryBufferIdx + 4] = modifier.axis[0]; // axis
                    this.geometryBuffer[this.#geometryBufferIdx + 5] = modifier.axis[1]; // axis
                    this.geometryBuffer[this.#geometryBufferIdx + 6] = modifier.axis[2]; // axis
                    this.geometryBuffer[this.#geometryBufferIdx + 7] = modifier.start * oneOverX; // start

                    this.geometryBuffer[this.#geometryBufferIdx + 8] = modifier.end * oneOverX; // end
                    break;
            }

            this.#geometryBufferIdx += modifier.getModifierSize() * 4;
        }
        return true;
    }

    processLight(light, offsetX, offsetY, offsetZ, lightColor, lightIntensity, lightRadius, lightType) {
        if (!this.#containedInRenderLayers(light)) {
            return true;
        }

        if (this.#lightBufferIdx / (SdfCanvas.VEC4_PER_LIGHT * 4) >= SdfCanvas.MAX_NUM_LIGHTS) {
            return false;
        }

        this.lightBuffer[this.#lightBufferIdx + 0] = offsetX;
        this.lightBuffer[this.#lightBufferIdx + 1] = offsetY;
        this.lightBuffer[this.#lightBufferIdx + 2] = offsetZ;

        this.lightBuffer[this.#lightBufferIdx + 4] = lightColor.r;
        this.lightBuffer[this.#lightBufferIdx + 5] = lightColor.g;
        this.lightBuffer[this.#lightBufferIdx + 6] = lightColor.b;

        this.lightBuffer[this.#lightBufferIdx + 8] = lightIntensity;
        this.lightBuffer[this.#lightBufferIdx + 9] = lightRadius;
        this.lightBuffer[this.#lightBufferIdx + 10] = lightType;
        // this.lightBuffer[lightBufferIdx + 7] = 0;

        this.#lightBufferIdx += SdfCanvas.VEC4_PER_LIGHT * 4;
        return true;
    }

    endUpdate() {
        this.numCommands = this.#commandBufferIdx / 4;
        this.numLights = this.#lightBufferIdx / (SdfCanvas.VEC4_PER_LIGHT * 4);
    }

    #sizeInBuffers(numGeomentryToAdd) {
        return this.#commandBufferIdx + 1 < SdfCanvas.MAX_NUM_COMMANDS || (this.#geometryBufferIdx / 4 + numGeomentryToAdd) < SdfCanvas.MAX_SIZE_ELEMENT_BUFFER;
    }

    #addToCommandBuffer(command) {
        this.commandBuffer[this.#commandBufferIdx] = command;
        this.commandBuffer[this.#commandBufferIdx + 1] = this.#geometryBufferIdx / 4;
        this.#commandBufferIdx += 4;
    }

    #addToCommandBufferIfSize(command, numGeomentryToAdd) {
        if (!this.#sizeInBuffers(numGeomentryToAdd)) {
            return false;
        }
        this.#addToCommandBuffer(command);
        return true;
    }

    #storeMat4InGeometryBuffer(mat, index) {
        this.geometryBuffer[index + 0] = mat[0]; // column 1 [mat[0], mat[1], mat[2], 0]^T
        this.geometryBuffer[index + 1] = mat[1];
        this.geometryBuffer[index + 2] = mat[2];

        this.geometryBuffer[index + 3] = mat[4]; // column 2 [mat[4], mat[5], mat[6], 0]^T
        this.geometryBuffer[index + 4] = mat[5];
        this.geometryBuffer[index + 5] = mat[6];

        this.geometryBuffer[index + 6] = mat[8]; // column 3 [mat[8], mat[9], mat[10], 0]^T
        this.geometryBuffer[index + 7] = mat[9];
        this.geometryBuffer[index + 8] = mat[10];

        this.geometryBuffer[index + 9] = mat[12]; // tx, column 4 [tx, ty, tz, 1]^T
        this.geometryBuffer[index + 10] = mat[13]; // ty
        this.geometryBuffer[index + 11] = mat[14]; // tz
    }

    #containedInRenderLayers(element) {
        return (element.bitmask.value & this.#bitmask.value) !== 0;
    }
}

export { PseudoSdfCanvas }