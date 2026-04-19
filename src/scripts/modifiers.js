import { SdfCommands } from "./sdf-commands.js";

class AModifier {
    constructor() { }

    getModifierType() {
        throw "Cannot get modifier type on abstract base class.";
    }

    getModifierSize() {
        throw "Cannot get modifier size on abstract base class";
    }

    static validateVec3(val) {
        if (!Array.isArray(val) || val.length !== 3) {
            throw new Error("Offset must be an array of 3 values.");
        }
    }
}

class Twist extends AModifier {

    static mode = Object.freeze({
        RELATIVE: 0,
        ABSOLUTE: 1,
    });

    target;

    constructor(target = null) {
        super();
        this.target = target;
    }

    // getters and setters 
    get amount() {
        const computedStyle = getComputedStyle(this.target);
        const amount = parseFloat(computedStyle.getPropertyValue("--twist-rate"));
        const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
        return 0.5 * Math.PI * amount / rootFontSize;
    }

    get axis() {
        const computedStyle = getComputedStyle(this.target);
        const axis = computedStyle.getPropertyValue('--twist-axis');
        return axis.split(' ').map(val => parseFloat(val));
    }

    get start() {
        const computedStyle = getComputedStyle(this.target);
        return parseFloat(computedStyle.getPropertyValue('--twist-start'));
    }

    get end() {
        const computedStyle = getComputedStyle(this.target);
        return parseFloat(computedStyle.getPropertyValue('--twist-end'));
    }

    getModifierType() {
        return SdfCommands.TWIST;
    }

    getModifierSize() {
        return 3;
    }
}

export { Twist }