import { SdfCommands } from "./sdf-commands.js";

class SdfLayer {
    constructor(layerOperation = SdfCommands.UNION, smoothingFactor = 0, layerDistortion = SdfCommands.LAYER_NONE) {
        this.layerOperation = layerOperation;
        this.smoothingFactor = smoothingFactor;
        this.layerDistortion = layerDistortion;
        this.elementsInLayer = 0;
    }

    setLayerOperation(layerOperation) {
        this.layerOperation = layerOperation;
    }

    setSmoothingFactor(smoothingFactor) {
        this.smoothingFactor = smoothingFactor;
    }
}

export { SdfLayer }