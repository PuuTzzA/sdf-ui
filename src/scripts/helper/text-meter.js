class TextMeter {
    constructor(element) {
        this.element = element;
        this.canvas = document.createElement("canvas");
        this.context = this.canvas.getContext("2d");

        this.updateStyles();
    }

    measure(text) {
        const metrics = this.context.measureText(text);
        return metrics;
    }

    updateStyles() {
        this.context.font = this.#getCanvasFont(this.element);
        this.context.letterSpacing = this.#getCssStyle(this.element, "letter-spacing") || "auto";
        this.context.wordSpacing = this.#getCssStyle(this.element, "word-spacing") || "auto";
    }

    #getCanvasFont(el) {
        const fontWeight = this.#getCssStyle(el, "font-weight") || "normal";
        const fontSize = this.#getCssStyle(el, "font-size") || "16px";
        const fontFamily = this.#getCssStyle(el, "font-family") || "Times New Roman";

        console.log("fontsize", fontSize)
        return `${fontWeight} ${fontSize} ${fontFamily}`;
    }

    #getCssStyle(element, prop) {
        return window.getComputedStyle(element, null).getPropertyValue(prop);
    }
}

export { TextMeter }