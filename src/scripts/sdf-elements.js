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

        this.dataset.elementType = this.getElementType();

        SdfCanvas.addTrackedElement(this);
    }

    getElementType() {
        throw "cannot get element type on abstract base class.";
    }

    disconnectedCallback() {
        console.log("Custom element removed from page.");
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
        const test = newValue * 22;
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

customElements.define("sdf-round-box", SdfRoundBox);

