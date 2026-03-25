import { SdfCanvas } from "./webgl/sdf-canvas.js";
import { TextMeter } from "./helper/text-meter.js"

class ASdfElement extends HTMLElement {
    static observedAttributes = ["data-layer-index", "data-element-type"];

    constructor() {
        super();
    }

    connectedCallback() {
        if (this.dataset.layerIndex == undefined) {
            this.dataset.layerIndex = 0;
        }

        if (this.dataset.renderLayers == undefined) {
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

class SdfText extends ASdfElement {
    connectedCallback() {
        super.connectedCallback();

        this.textMeter = new TextMeter(this);

        this.numWords = this.getWordRects().length;
        this.numLetters = this.textContent.replace(/\s+/g, '').length;
    }

    getElementType() {
        return SdfCanvas.ElementType.TEXT;
    }

    getLength() {
        // in amounts of vec4s
        const numWords = this.getWordRects().length;
        const numLetters = this.textContent.replace(/\s+/g, '').length;
        return numWords * 4 + numLetters * 3;
    }

    getWordRects() {
        const results = [];

        // Create a SINGLE range object to reuse for all measurements.
        // This drastically reduces memory allocation and GC pressure.
        const range = document.createRange();

        const treeWalker = document.createTreeWalker(
            this,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        let textNode;
        while ((textNode = treeWalker.nextNode())) {

            const text = textNode.nodeValue;
            const regex = /\S+/g; // find words that are separated by whitespace
            let match;

            while ((match = regex.exec(text)) !== null) {
                const chunk = match[0];
                const startIndex = match.index;
                const endIndex = startIndex + chunk.length;

                // Update the existing range instead of creating a new one
                range.setStart(textNode, startIndex);
                range.setEnd(textNode, endIndex);

                const rects = range.getClientRects();

                if (rects.length === 1) {
                    results.push([chunk, rects[0]]);
                } else if (rects.length > 1) {
                    let partStart = startIndex;

                    for (let i = 1; i <= chunk.length; i++) {
                        const testEnd = startIndex + i;

                        // Repurpose the range to test the substring
                        range.setStart(textNode, partStart);
                        range.setEnd(textNode, testEnd);

                        const testRects = range.getClientRects();

                        if (testRects.length > 1) {
                            const validEnd = testEnd - 1;

                            if (validEnd > partStart) {
                                // Repurpose the range one more time to grab the valid rect
                                range.setStart(textNode, partStart);
                                range.setEnd(textNode, validEnd);

                                results.push([
                                    text.substring(partStart, validEnd),
                                    range.getClientRects()[0]
                                ]);

                                partStart = validEnd;
                            }
                        }
                    }

                    if (partStart < endIndex) {
                        // Repurpose the range for the final trailing piece of the broken word
                        range.setStart(textNode, partStart);
                        range.setEnd(textNode, endIndex);

                        const finalRects = range.getClientRects();
                        if (finalRects.length > 0) {
                            results.push([
                                text.substring(partStart, endIndex),
                                finalRects[0]
                            ]);
                        }
                    }
                }
            }
        }

        return results;
    }

    measure(text) {
        return this.textMeter.measure(text).width;
    }

    measureHeight(text) {
        const metrics = this.textMeter.measure(text);
        return metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
    }
}

customElements.define("sdf-text", SdfText)