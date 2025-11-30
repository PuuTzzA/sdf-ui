import { SdfCanvas } from "./sdf-canvas.js";

function initPositionBuffer(gl, programInfo) {
    const positionBuffer = gl.createBuffer();

    // Select the positionBuffer as the one to apply buffer
    // operations to from here out.
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

    // Now create an array of positions for the square.
    const positions = [
        -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0, -1.0, // triangle strip
    ];

    // Now pass the list of positions into WebGL to build the
    // shape. We do this by creating a Float32Array from the
    // JavaScript array, then use it to fill the current buffer.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    gl.enableVertexAttribArray(programInfo.attribLocations.vertexPosition);

    // vertexAttribPointer(index, size, type, normalized, stride, offset)
    gl.vertexAttribPointer(programInfo.attribLocations.vertexPosition, 2, gl.FLOAT, false, 0, 0);

    return positionBuffer;
}

function initUvBuffer(gl, programInfo) {
    const textureCoordBuffer = gl.createBuffer();

    gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordBuffer);

    const textureCoordinates = [
        0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 1.0, 1.0, // triangle strip
    ];

    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(textureCoordinates), gl.STATIC_DRAW);

    gl.enableVertexAttribArray(programInfo.attribLocations.vertexUv);

    // vertexAttribPointer(index, size, type, normalized, stride, offset)
    gl.vertexAttribPointer(programInfo.attribLocations.vertexUv, 2, gl.FLOAT, false, 0, 0);

    return textureCoordBuffer;
}

function initGeometryBufferObject(gl, programInfo) {
    const geometryBuffer = gl.createBuffer();

    gl.uniformBlockBinding(
        programInfo.program,
        programInfo.uniformLocations.geometryBlock,
        SdfCanvas.GEOMETRY_BLOCK_UNIFORM_BUFFER_BINDING_INDEX
    );

    gl.bindBufferBase(
        gl.UNIFORM_BUFFER,
        SdfCanvas.GEOMETRY_BLOCK_UNIFORM_BUFFER_BINDING_INDEX,
        geometryBuffer
    );

    gl.bufferData(
        gl.UNIFORM_BUFFER,
        SdfCanvas.MAX_TRACKED_ELEMENTS * SdfCanvas.VEC4_PER_ELEMENT * 4 * Float32Array.BYTES_PER_ELEMENT,
        gl.DYNAMIC_DRAW
    );

    return geometryBuffer;
}

function initShadingBufferObject(gl, programInfo) {
    const shadingBuffer = gl.createBuffer();

    gl.uniformBlockBinding(
        programInfo.program,
        programInfo.uniformLocations.shadingBlock,
        SdfCanvas.SHADING_BLOCK_UNIFORM_BUFFER_BINDING_INDEX
    );

    gl.bindBufferBase(
        gl.UNIFORM_BUFFER,
        SdfCanvas.SHADING_BLOCK_UNIFORM_BUFFER_BINDING_INDEX,
        shadingBuffer
    );

    gl.bufferData(
        gl.UNIFORM_BUFFER,
        SdfCanvas.MAX_TRACKED_ELEMENTS * SdfCanvas.VEC4_PER_ELEMENT * 4 * Float32Array.BYTES_PER_ELEMENT,
        gl.DYNAMIC_DRAW
    );

    return shadingBuffer;
}

function initBuffers(gl, programInfo) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const positionBuffer = initPositionBuffer(gl, programInfo);
    const uvBuffer = initUvBuffer(gl, programInfo);
    const geometryBuffer = initGeometryBufferObject(gl, programInfo);
    const shadingBuffer = initShadingBufferObject(gl, programInfo);

    gl.bindVertexArray(null);

    return {
        vao: vao,
        position: positionBuffer,
        uv: uvBuffer,
        geometryBuffer: geometryBuffer,
        shadingBuffer: shadingBuffer
    };
}

export { initBuffers };
