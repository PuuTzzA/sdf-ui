import { SdfCanvas } from "../sdf-canvas.js";

// Program Loading
async function loadShadersFromDisk(vertexName, fragmentName, directory = "../../shaders/") {
    // Resolve the paths relative to the current JavaScript file's URL
    const vertexPath = new URL(directory + vertexName, import.meta.url);
    const fragmentPath = new URL(directory + fragmentName, import.meta.url);

    // Promise.all starts both fetch requests immediately and waits for both to finish
    const [vertexSource, fragmentSource] = await Promise.all([
        fetch(vertexPath).then(response => response.text()),
        fetch(fragmentPath).then(response => response.text())
    ]);

    return {
        vertexSource,
        fragmentSource,
    };
}

function initShaderProgram(gl, vsSource, fsSource) {
    return new Promise((resolve, reject) => {
        const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vsSource);
        const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource);

        // Create the shader program
        const shaderProgram = gl.createProgram(); // program of vertex + fragment shader
        gl.attachShader(shaderProgram, vertexShader);
        gl.attachShader(shaderProgram, fragmentShader);
        gl.linkProgram(shaderProgram);

        // Try to get the parallel compilation extension
        const ext = gl.getExtension("KHR_parallel_shader_compile");

        const checkCompletion = () => {
            if (ext) {
                // If extension exists, check if compilation is done in the background
                if (gl.getProgramParameter(shaderProgram, ext.COMPLETION_STATUS_KHR)) {
                    // Check program link status; if OK, use it.
                    finalizeProgram(gl, shaderProgram, vertexShader, fragmentShader, resolve, reject);
                } else {
                    // Not done yet, check again next frame!
                    requestAnimationFrame(checkCompletion);
                }
            } else {
                // Program linking is synchronous.
                // We yielded for at least one frame so the UI could paint. Now we force the check.
                finalizeProgram(gl, shaderProgram, vertexShader, fragmentShader, resolve, reject);
            }
        };

        // Start the polling loop on the next frame
        requestAnimationFrame(checkCompletion);
    });
}

function finalizeProgram(gl, shaderProgram, vertexShader, fragmentShader, resolve, reject) {
    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        console.error("Shader program failed to link: ", gl.getProgramInfoLog(shaderProgram));
        console.error("Vertex log: ", gl.getShaderInfoLog(vertexShader));
        console.error("Fragment log: ", gl.getShaderInfoLog(fragmentShader));
        alert("Unable to initialize the shader program.");
        reject(new Error("Shader initialization failed"));
        return;
    }
    resolve(shaderProgram);
}

function loadShader(gl, type, source) {
    const shader = gl.createShader(type); // either vertex or fragment

    // Send the source to the shader object
    gl.shaderSource(shader, source);

    // Compile the shader program (This now happens in the background!)
    gl.compileShader(shader);

    // REMOVED: gl.getShaderParameter(shader, gl.COMPILE_STATUS)
    // Querying the status here would force the browser to freeze.
    return shader;
}

// Buffer initialization
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
        // 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0, 0.0, // origin bottom left
    ];

    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(textureCoordinates), gl.STATIC_DRAW);

    gl.enableVertexAttribArray(programInfo.attribLocations.vertexUv);

    // vertexAttribPointer(index, size, type, normalized, stride, offset)
    gl.vertexAttribPointer(programInfo.attribLocations.vertexUv, 2, gl.FLOAT, false, 0, 0);

    return textureCoordBuffer;
}

function initCommandBufferObject(gl, programInfo) {
    const commandBuffer = gl.createBuffer();

    gl.uniformBlockBinding(
        programInfo.program,
        programInfo.uniformLocations.commandBlock,
        SdfCanvas.COMMAND_BLOCK_UNIFORM_BUFFER_BINDING_INDEX,
    );

    gl.bindBufferBase(
        gl.UNIFORM_BUFFER,
        SdfCanvas.COMMAND_BLOCK_UNIFORM_BUFFER_BINDING_INDEX,
        commandBuffer,
    );

    gl.bufferData(
        gl.UNIFORM_BUFFER,
        SdfCanvas.MAX_NUM_COMMANDS * 4 * Int32Array.BYTES_PER_ELEMENT,
        gl.DYNAMIC_DRAW,
    )

    return commandBuffer;
}

function initGeometryBufferObject(gl, programInfo) {
    const geometryBuffer = gl.createBuffer();

    gl.uniformBlockBinding(
        programInfo.program,
        programInfo.uniformLocations.geometryBlock,
        SdfCanvas.GEOMETRY_BLOCK_UNIFORM_BUFFER_BINDING_INDEX,
    );

    gl.bindBufferBase(
        gl.UNIFORM_BUFFER,
        SdfCanvas.GEOMETRY_BLOCK_UNIFORM_BUFFER_BINDING_INDEX,
        geometryBuffer,
    );

    gl.bufferData(
        gl.UNIFORM_BUFFER,
        SdfCanvas.MAX_SIZE_ELEMENT_BUFFER * 4 * Float32Array.BYTES_PER_ELEMENT,
        gl.DYNAMIC_DRAW,
    );

    return geometryBuffer;
}

function initShadingBufferObject(gl, programInfo) {
    const shadingBuffer = gl.createBuffer();

    gl.uniformBlockBinding(
        programInfo.program,
        programInfo.uniformLocations.shadingBlock,
        SdfCanvas.SHADING_BLOCK_UNIFORM_BUFFER_BINDING_INDEX,
    );

    gl.bindBufferBase(
        gl.UNIFORM_BUFFER,
        SdfCanvas.SHADING_BLOCK_UNIFORM_BUFFER_BINDING_INDEX,
        shadingBuffer,
    );

    gl.bufferData(
        gl.UNIFORM_BUFFER,
        SdfCanvas.MAX_SIZE_ELEMENT_BUFFER * 4 * Float32Array.BYTES_PER_ELEMENT,
        gl.DYNAMIC_DRAW,
    );

    return shadingBuffer;
}

function initLightBufferObject(gl, programInfo) {
    const lightBuffer = gl.createBuffer();

    gl.uniformBlockBinding(
        programInfo.program,
        programInfo.uniformLocations.lightBlock,
        SdfCanvas.LIGHT_BLOCK_UNIFORM_BUFFER_BINDING_INDEX,
    );

    gl.bindBufferBase(
        gl.UNIFORM_BUFFER,
        SdfCanvas.LIGHT_BLOCK_UNIFORM_BUFFER_BINDING_INDEX,
        lightBuffer,
    );

    gl.bufferData(
        gl.UNIFORM_BUFFER,
        SdfCanvas.MAX_NUM_LIGHTS * SdfCanvas.VEC4_PER_LIGHT * 4 * Float32Array.BYTES_PER_ELEMENT,
        gl.DYNAMIC_DRAW,
    );

    return lightBuffer;
}

function initBuffers(gl, programInfo) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const positionBuffer = initPositionBuffer(gl, programInfo);
    const uvBuffer = initUvBuffer(gl, programInfo);
    const commandBuffer = initCommandBufferObject(gl, programInfo);
    const geometryBuffer = initGeometryBufferObject(gl, programInfo);
    const shadingBuffer = initShadingBufferObject(gl, programInfo);
    const lightBuffer = initLightBufferObject(gl, programInfo);

    gl.bindVertexArray(null);

    return {
        vao: vao,
        position: positionBuffer,
        uv: uvBuffer,
        commandBuffer: commandBuffer,
        geometryBuffer: geometryBuffer,
        shadingBuffer: shadingBuffer,
        lightBuffer: lightBuffer,
    };
}

// Webgl manipulation
function injectGLSL(mainString, searchString, replaceString) {
    // from Gemini
    // 1. Escape the search string for regex
    const escapedSearch = searchString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // 2. Create the regex pattern
    // #insert\s+ -> Matches "#insert" followed by one or more spaces
    // \b         -> Word boundary ensures "MAIN" doesn't match "MAIN_LOOP"
    // 'g' flag   -> Replaces ALL occurrences in the string
    const regex = new RegExp(`#insert\\s+${escapedSearch}\\b`, 'g');

    // 3. Replace and return
    return mainString.replace(regex, replaceString);
}

function toGlslVec2Array(points) {
    const formatFloat = (num) => {
        return Number.isInteger(num) ? `${num.toFixed(1)}f` : `${num}f`;
    };

    const vecStrings = points.map(([x, y]) => {
        return `vec2(${formatFloat(x)}, ${formatFloat(y)})`;
    });

    return `vec2[](${vecStrings.join(', ')})`;
}

export { loadShadersFromDisk, initShaderProgram, initBuffers, injectGLSL, toGlslVec2Array };
