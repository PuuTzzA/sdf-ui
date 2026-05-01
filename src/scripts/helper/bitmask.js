class BitMask {
    static MAX_LAYER = 31;

    value = 0;

    constructor(input) {
        if (!input) return;

        if (typeof input === "string") {
            this.updateString(input);
        } else if (Array.isArray(input)) {
            this.updateArray(input);
        }
    }

    updateString(string) {
        this.value = 0;
        if (string.trim() === "") return;

        const parts = string.split(" ");
        for (let i = 0; i < parts.length; i++) {
            const parsed = parseInt(parts[i], 10);

            // Protect against empty strings (double spaces) resulting in NaN
            if (!isNaN(parsed)) {
                const position = Math.max(0, Math.min(parsed, BitMask.MAX_LAYER));
                this.value |= (1 << position);
            }
        }
    }

    updateArray(array) {
        this.value = 0;
        for (let i = 0; i < array.length; i++) {
            const parsed = parseInt(array[i], 10);
            if (!isNaN(parsed)) {
                const position = Math.max(0, Math.min(parsed, BitMask.MAX_LAYER));
                this.value |= (1 << position);
            }
        }
    }
}

export { BitMask }