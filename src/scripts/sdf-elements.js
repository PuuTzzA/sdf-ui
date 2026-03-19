import { SdfCanvas } from "./webgl/sdf-canvas.js";

class ASdfElement extends HTMLElement {
    static observedAttributes = ["data-layer-index", "data-element-type"];

    constructor() {
        super();
    }

    connectedCallback() {
        if (this.dataset.layerIndex == undefined) {
            this.dataset.layerIndex = 0;
        }

        if (this.dataset.renderLayers == undefined){
            this.dataset.renderLayers = 0;
        }

        this.classList.add("sdf-ui-base-class");
        this.dataset.elementType = this.getElementType();

        SdfCanvas.addTrackedElement(this);
    }

    getElementType() {
        throw "Cannot get element type on abstract base class.";
    }

    disconnectedCallback() {
        SdfCanvas.removeTrackedElement(this);
    }

    connectedMoveCallback() {
        console.log("Custom element moved with moveBefore()");
    }

    adoptedCallback() {
        console.log("Custom element moved to new page.");
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name == "data-layer-index") {
            SdfCanvas.sortTrackedElements();
        }

        // console.log(`Attribute ${name} has changed from ${oldValue} to ${newValue}.`);
    }
}

class SdfSphere extends ASdfElement {
    getElementType() {
        return SdfCanvas.ElementType.SPHERE;
    }
}

customElements.define("sdf-sphere", SdfSphere);

class SdfBoxSimple extends ASdfElement {
    getElementType() {
        return SdfCanvas.ElementType.BOX_SIMPLE;
    }
}

customElements.define("sdf-box-simple", SdfBoxSimple);

class SdfBox extends ASdfElement {
    getElementType() {
        return SdfCanvas.ElementType.BOX;
    }
}

customElements.define("sdf-box", SdfBox);

class SdfRoundBox extends ASdfElement {
    getElementType() {
        return SdfCanvas.ElementType.ROUND_BOX;
    }
}

customElements.define("sdf-box-round", SdfRoundBox);

