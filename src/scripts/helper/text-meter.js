class TextMeter {
    constructor(element) {
        this.canvas = document.createElement("canvas");
        this.context = this.canvas.getContext("2d");

        this.context.font = this.getCanvasFont(element);
        this.context.letterSpacing = this.getCssStyle(element, "letter-spacing") || "auto";
        this.context.wordSpacing = this.getCssStyle(element, "word-spacing") || "auto";
    }

    measure(text) {
        const metrics = this.context.measureText(text);
        return metrics;
    }

    getCanvasFont(el) {
        const fontWeight = this.getCssStyle(el, "font-weight") || "normal";
        const fontSize = this.getCssStyle(el, "font-size") || "16px";
        const fontFamily = this.getCssStyle(el, "font-family") || "Times New Roman";

        console.log("fontsize", fontSize)
        return `${fontWeight} ${fontSize} ${fontFamily}`;
    }

    getCssStyle(element, prop) {
        return window.getComputedStyle(element, null).getPropertyValue(prop);
    }
}

export {TextMeter}