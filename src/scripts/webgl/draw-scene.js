let mouse = { x: 0, y: 0 };

window.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
});

function drawScene(gl, programInfo, buffers, mousepos) {
    gl.clearColor(1.0, 0.0, 1.0, 1.0); // Clear to black, fully opaque
    gl.clearDepth(1.0); // Clear everything
    gl.enable(gl.DEPTH_TEST); // Enable depth testing
    gl.depthFunc(gl.LEQUAL); // Near things obscure far things

    // Clear the canvas before we start drawing on it.

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Tell WebGL how to pull out the positions from the position
    // buffer into the vertexPosition attribute.
    //setPositionAttribute(gl, buffers, programInfo);
    //setColorAttribute(gl, buffers, programInfo);
    //setUvAttribute(gl, buffers, programInfo);
    // Tell WebGL which indices to use to index the vertices
    gl.bindVertexArray(buffers.vao);

    // Tell WebGL to use our program when drawing
    gl.useProgram(programInfo.program);

    // Set the shader uniforms
    gl.uniform2f(programInfo.uniformLocations.resolution, programInfo.canvas.offsetWidth, programInfo.canvas.offsetHeight);

    const testDiv = document.querySelector("#test-div");

    let geometryBuffer = new Float32Array(programInfo.maxBufferSize * 4);
    let resolution = [canvas.clientWidth, canvas.clienHeight];
    geometryBuffer[0] = 300 / resolution[0];
    geometryBuffer[1] = 300 / resolution[0];
    geometryBuffer[0] = mouse.x / resolution[0];
    geometryBuffer[1] = mouse.y / resolution[0];
    geometryBuffer[2] = parseFloat(getComputedStyle(testDiv).getPropertyValue("--depth"));
    geometryBuffer[3] = 300 / resolution[0];

    //console.log(mousepos[0], mousepos[1])
    //console.log(programInfo.canvas.offsetWidth, programInfo.canvas.offsetHeight)

    gl.bindBuffer(gl.UNIFORM_BUFFER, buffers.geometryBuffer);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, geometryBuffer);

    let shadingBuffer = new Float32Array(programInfo.maxBufferSize * 4);
    shadingBuffer[3] = 0.0;

    gl.bindBuffer(gl.UNIFORM_BUFFER, buffers.shadingBuffer);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, shadingBuffer);

    {
        const offset = 0;
        const vertexCount = 4;
        gl.drawArrays(gl.TRIANGLE_STRIP, offset, vertexCount);
    }
}

export { drawScene };