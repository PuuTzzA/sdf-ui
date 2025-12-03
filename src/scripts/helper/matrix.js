class Matrix {
    static parseMatrix(string) {
        if (string == "none") {
            return new Float32Array([
                1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                0, 0, 0, 1
            ]);
        }
        if (string.includes("matrix3d")) {
            return this.parseMatrix3d(string);
        }
        return this.parseMatrix2d(string);
    }

    static parseMatrix2d(str) {
        // matrix(a,b,c,d,e,f)
        const v = str
            .replace("matrix(", "")
            .replace(")", "")
            .split(",")
            .map(n => parseFloat(n));

        // Convert 2D matrix into 3D 4×4 affine matrix
        return new Float32Array([
            v[0], v[1], 0, 0,
            v[2], v[3], 0, 0,
            0, 0, 1, 0,
            v[4], v[5], 0, 1
        ]);
    }

    static parseMatrix3d(str) {
        const values = str
            .replace("matrix3d(", "")
            .replace(")", "")
            .split(",")
            .map(v => parseFloat(v.trim()));

        return new Float32Array(values);
    }

    static invertMat4(m) {
        // from ChatGPT
        const a = m;
        const out = new Float32Array(16);

        const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
        const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
        const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
        const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

        const b00 = a00 * a11 - a01 * a10;
        const b01 = a00 * a12 - a02 * a10;
        const b02 = a00 * a13 - a03 * a10;
        const b03 = a01 * a12 - a02 * a11;
        const b04 = a01 * a13 - a03 * a11;
        const b05 = a02 * a13 - a03 * a12;
        const b06 = a20 * a31 - a21 * a30;
        const b07 = a20 * a32 - a22 * a30;
        const b08 = a20 * a33 - a23 * a30;
        const b09 = a21 * a32 - a22 * a31;
        const b10 = a21 * a33 - a23 * a31;
        const b11 = a22 * a33 - a23 * a32;

        const det =
            b00 * b11 - b01 * b10 + b02 * b09 +
            b03 * b08 - b04 * b07 + b05 * b06;

        const invDet = 1.0 / det;

        out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * invDet;
        out[1] = (-a01 * b11 + a02 * b10 - a03 * b09) * invDet;
        out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * invDet;
        out[3] = (-a21 * b05 + a22 * b04 - a23 * b03) * invDet;
        out[4] = (-a10 * b11 + a12 * b08 - a13 * b07) * invDet;
        out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * invDet;
        out[6] = (-a30 * b05 + a32 * b02 - a33 * b01) * invDet;
        out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * invDet;
        out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * invDet;
        out[9] = (-a00 * b10 + a01 * b08 - a03 * b06) * invDet;
        out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * invDet;
        out[11] = (-a20 * b04 + a21 * b02 - a23 * b00) * invDet;
        out[12] = (-a10 * b09 + a11 * b07 - a12 * b06) * invDet;
        out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * invDet;
        out[14] = (-a30 * b03 + a31 * b01 - a32 * b00) * invDet;
        out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * invDet;

        return out;
    }
}

export { Matrix }