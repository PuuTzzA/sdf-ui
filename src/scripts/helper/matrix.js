class Matrix {
    // Attention all three are column major, so not as they appear
    static rotation90DegX = new Float32Array([
        1, 0, 0, 0,
        0, 0, -1, 0,
        0, 1, 0, 0,
        0, 0, 0, 1,
    ])

    static rotation90DegY = new Float32Array([
        0, 0, 1, 0,
        0, 1, 0, 0,
        -1, 0, 0, 0,
        0, 0, 0, 1,
    ])

    static rotation90DegZ = new Float32Array([
        0, -1, 0, 0,
        1, 0, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
    ])

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

    /**
     * Relatively slow, but works for a general matrix and does not mutate the input 
     */
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

    /**
     * if A = [M    b] => inv(A) = [inv(M)  -inv(M) * b] 
     *        [0    1]             [  0           1    ]
     */
    static invertAffineMat4InPlace(m) {
        // from gemini  
        // Extract the 3x3 rotational/scaling matrix (M)
        const m00 = m[0], m01 = m[4], m02 = m[8];
        const m10 = m[1], m11 = m[5], m12 = m[9];
        const m20 = m[2], m21 = m[6], m22 = m[10];

        // Compute cofactors of the first row to find the 3x3 determinant
        const b00 = m11 * m22 - m12 * m21;
        const b01 = m12 * m20 - m10 * m22;
        const b02 = m10 * m21 - m11 * m20;

        const det = m00 * b00 + m01 * b01 + m02 * b02;

        /* if (!det) {
            return null; // Matrix is not invertible
        } */

        const invDet = 1.0 / det;

        // Calculate the inverse of the 3x3 matrix M (M^-1)
        const invM00 = b00 * invDet;
        const invM10 = b01 * invDet;
        const invM20 = b02 * invDet;

        const invM01 = (m02 * m21 - m01 * m22) * invDet;
        const invM11 = (m00 * m22 - m02 * m20) * invDet;
        const invM21 = (m01 * m20 - m00 * m21) * invDet;

        const invM02 = (m01 * m12 - m02 * m11) * invDet;
        const invM12 = (m02 * m10 - m00 * m12) * invDet;
        const invM22 = (m00 * m11 - m01 * m10) * invDet;

        // Extract the original translation vector (b)
        const tx = m[12];
        const ty = m[13];
        const tz = m[14];

        // 1. Output the inverted 3x3 matrix into the 4x4 array
        m[0] = invM00;
        m[1] = invM10;
        m[2] = invM20;
        m[3] = 0;

        m[4] = invM01;
        m[5] = invM11;
        m[6] = invM21;
        m[7] = 0;

        m[8] = invM02;
        m[9] = invM12;
        m[10] = invM22;
        m[11] = 0;

        // 2. Output the new translation vector (-M^-1 * b)
        m[12] = -(invM00 * tx + invM01 * ty + invM02 * tz);
        m[13] = -(invM10 * tx + invM11 * ty + invM12 * tz);
        m[14] = -(invM20 * tx + invM21 * ty + invM22 * tz);
        m[15] = 1; // 3. Maintain the affine bottom row

        return m;
    }

    static extractMat3FromMat4(m) {
        return new Float32Array([
            m[0], m[1], m[2],
            m[4], m[5], m[6],
            m[8], m[9], m[10],
        ])
    }

    static negateMat3InPlace(m) {
        for (let i = 0; i < 9; i++) {
            m[i] *= -1;
        }
    }

    static mat3TimesVec3InPlace(m, v) {
        const v0 = v[0];
        const v1 = v[1];
        const v2 = v[2];

        v[0] = m[0] * v0 + m[3] * v1 + m[6] * v2;
        v[1] = m[1] * v0 + m[4] * v1 + m[7] * v2;
        v[2] = m[2] * v0 + m[5] * v1 + m[8] * v2;
    }

    /**
     * Computes A @ B and stores the result in B
     * Assumes A and B are Float32Array(16) in column-major order.
     * 
     * @param {Float32Array} A - The left operand
     * @param {Float32Array} B - The right operand and the destination array
     * @returns {Float32Array} B (for chaining)
     */
    static mat4TimesMat4InPlace(A, B) {
        // Cache the entire A matrix upfront. 
        // This is mathematically necessary because computing *any* column 
        // of the result requires reading across all columns of A.
        const a00 = A[0], a10 = A[1], a20 = A[2], a30 = A[3];
        const a01 = A[4], a11 = A[5], a21 = A[6], a31 = A[7];
        const a02 = A[8], a12 = A[9], a22 = A[10], a32 = A[11];
        const a03 = A[12], a13 = A[13], a23 = A[14], a33 = A[15];

        let b0, b1, b2, b3;

        // --- Column 0 ---
        // Read column 0 of B, then overwrite column 0 of B
        b0 = B[0]; b1 = B[1]; b2 = B[2]; b3 = B[3];
        B[0] = b0 * a00 + b1 * a01 + b2 * a02 + b3 * a03;
        B[1] = b0 * a10 + b1 * a11 + b2 * a12 + b3 * a13;
        B[2] = b0 * a20 + b1 * a21 + b2 * a22 + b3 * a23;
        B[3] = b0 * a30 + b1 * a31 + b2 * a32 + b3 * a33;

        // --- Column 1 ---
        // Read column 1 of B, then overwrite column 1 of B
        b0 = B[4]; b1 = B[5]; b2 = B[6]; b3 = B[7];
        B[4] = b0 * a00 + b1 * a01 + b2 * a02 + b3 * a03;
        B[5] = b0 * a10 + b1 * a11 + b2 * a12 + b3 * a13;
        B[6] = b0 * a20 + b1 * a21 + b2 * a22 + b3 * a23;
        B[7] = b0 * a30 + b1 * a31 + b2 * a32 + b3 * a33;

        // --- Column 2 ---
        // Read column 2 of B, then overwrite column 2 of B
        b0 = B[8]; b1 = B[9]; b2 = B[10]; b3 = B[11];
        B[8] = b0 * a00 + b1 * a01 + b2 * a02 + b3 * a03;
        B[9] = b0 * a10 + b1 * a11 + b2 * a12 + b3 * a13;
        B[10] = b0 * a20 + b1 * a21 + b2 * a22 + b3 * a23;
        B[11] = b0 * a30 + b1 * a31 + b2 * a32 + b3 * a33;

        // --- Column 3 ---
        // Read column 3 of B, then overwrite column 3 of B
        b0 = B[12]; b1 = B[13]; b2 = B[14]; b3 = B[15];
        B[12] = b0 * a00 + b1 * a01 + b2 * a02 + b3 * a03;
        B[13] = b0 * a10 + b1 * a11 + b2 * a12 + b3 * a13;
        B[14] = b0 * a20 + b1 * a21 + b2 * a22 + b3 * a23;
        B[15] = b0 * a30 + b1 * a31 + b2 * a32 + b3 * a33;

        return B;
    }
}

export { Matrix }