import { SdfCanvas } from "./webgl/sdf-canvas.js";
import { TextMeter } from "./helper/text-meter.js"
import { SdfCommands } from "./webgl/sdf-commands.js";

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
        return SdfCommands.SPHERE;
    }
}

customElements.define("sdf-sphere", SdfSphere);

class SdfBoxSimple extends ASdfElement {
    getElementType() {
        return SdfCommands.BOX_SIMPLE;
    }
}

customElements.define("sdf-box-simple", SdfBoxSimple);

class SdfBox extends ASdfElement {
    getElementType() {
        return SdfCommands.BOX;
    }
}

customElements.define("sdf-box", SdfBox);

class SdfText extends ASdfElement {
    connectedCallback() {
        super.connectedCallback();

        this.classList.add("sdf-ui-text-base-class");
        this.textMeter = new TextMeter(this);

        this.numLetters = 0;
        this.size = 0;
        this.update();
    }

    getElementType() {
        return SdfCommands.TEXT;
    }

    getNumberOfLetters() {
        return this.numLetters;
    }

    getSize() {
        // in amounts of vec4s
        return this.size
    }

    update() { // to avoid size changing during function calls or something
        this.numLetters = this.textContent.replace(/\s+/g, '').length;
        this.size = 1 + this.numLetters;
        this.textMeter.updateStyles();
    }

    /***
     * Returns a two dimensional array of the split words/letters and their bounding boxes.
     * E.g. for an element with the text "Hello<br>World" it would return the following array:
     * [["Hello", rect], ["World", rect]]
     * Also works for automatically split words (e.g. word-break: break-all or when words just wrap onto new lines)
     */
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