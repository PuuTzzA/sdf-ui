#version 300 es

in vec2 aPosition;

out vec2 vUv;

void main() {
    vUv = aPosition * 0.5f + 0.5f;
    gl_Position = vec4(aPosition, 0.0f, 1.0f);
}