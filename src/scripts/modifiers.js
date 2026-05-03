import { SdfCommands } from "./sdf-commands.js";

class AModifier {
    active;

    constructor(active = true) {
        this.active = active;
    }

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

    constructor(target = null, active = true) {
        super(active);
        this.target = target;
    }

    // getters and setters 
    get computedStyle() {
        return getComputedStyle(this.target);
    }

    calculateAmount(computedStyle) {
        const amount = parseFloat(computedStyle.getPropertyValue("--twist-rate"));
        const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
        return Math.PI * amount / rootFontSize;
    }

    calculateAxis(computedStyle) {
        const axis = computedStyle.getPropertyValue('--twist-axis');
        return axis.split(' ').map(val => parseFloat(val));
    }

    getModifierType() {
        return SdfCommands.TWIST;
    }

    getModifierSize() {
        return 3;
    }
}

export { Twist }