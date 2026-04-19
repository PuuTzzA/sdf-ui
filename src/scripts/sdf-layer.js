import { SdfCommands } from "./sdf-commands.js";

class SdfLayer {
    layerOperation;
    smoothingFactor;
    elementsInLayer;

    constructor(layerOperation = SdfCommands.UNION, smoothingFactor = 0) {
        this.layerOperation = layerOperation;
        this.smoothingFactor = smoothingFactor;
        this.elementsInLayer = 0;
    }
}

export { SdfLayer }