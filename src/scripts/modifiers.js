import { SdfCommands } from "./webgl/sdf-commands.js";

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
    #amount;
    #axis;

    constructor(target = null, amount = 10, axis = [0, 1, 0]) {
        super();
        this.target = target;
        this.amount = amount;
        this.axis = axis;
    }

    // getters and setters 
    get amount() {
        const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
        return 0.5 * Math.PI * this.#amount / rootFontSize;
    }

    set amount(val) { // in revolutions per rem
        this.#amount = val;
    }

    get axis() {
        return this.#axis;
    }

    set axis(val) {
        AModifier.validateVec3(val);
        this.#axis = val;
    }

    getModifierType() {
        return SdfCommands.TWIST;
    }

    getModifierSize() {
        return 2;
    }
}

export { Twist }