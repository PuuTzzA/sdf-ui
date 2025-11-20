#version 300 es

layout(location = 0) in vec4 aVertexPosition;
layout(location = 1) in vec2 aVertexUv;

out vec2 vUv;

void main(void) {
    gl_Position = aVertexPosition;
    vUv = aVertexUv;
}