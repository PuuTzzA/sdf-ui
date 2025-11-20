#version 300 es
precision highp float;

#define MAX_OBJECTS 256

// ╔══════════════════════════════════════════════════════════╗
// ║                       UNIFORMS                           ║
// ╚══════════════════════════════════════════════════════════╝
layout(std140) uniform GeometryBlock {
    vec4 geometryData[MAX_OBJECTS];
};
layout(std140) uniform ShadingBlock {
    vec4 shadingData[MAX_OBJECTS];
};
uniform vec2 resolution;

// ╔══════════════════════════════════════════════════════════╗
// ║                 SHADER INPUT, OUTPUT                     ║
// ╚══════════════════════════════════════════════════════════╝
in vec2 vUv;
out vec4 fragColor;

// ╔══════════════════════════════════════════════════════════╗
// ║                         SDFs                             ║
// ╚══════════════════════════════════════════════════════════╝
float sdSphere(vec3 p, float s) {
    return length(p) - s;
}

float map(vec3 p) {
    // custom sphere position + radius
    vec3 spherePos = vec3(geometryData[0].xy, 10000.);
    float sphereRadius = 100.0f;

    return sdSphere(p - spherePos, sphereRadius);
}

vec3 trace(vec3 ro, vec3 rd) {
    const float tMax = 100000.0f;
    const float eps = 0.001f;
    const int maxSteps = 128;

    float t = 0.0f;   // distance traveled along ray

    for(int i = 0; i < maxSteps; i++) {

        vec3 p = ro + rd * t;   // current sample position
        float d = map(p);       // distance to nearest surface

        if(d < eps) {
            // hit — return a basic color (white)
            return vec3(1.0f);
        }

        t += d;                 // march forward safely

        if(t > tMax)
            break;    // escaped (no hit)
    }

    // miss — return background
    return vec3(0.0f);
}

// ╔══════════════════════════════════════════════════════════╗
// ║                         MAIN                             ║
// ╚══════════════════════════════════════════════════════════╝
void main(void) {
/*     const vec2 subPixleOffsets[] = vec2[]( 
        vec2(0.375,0.125)-vec2(0.5),
        vec2(0.875,0.375)-vec2(0.5),
        vec2(0.125,0.625)-vec2(0.5),
        vec2(0.625,0.875)-vec2(0.5)
    ); */
    const vec2 subPixleOffsets[] = vec2[](vec2(0.f, 0.f));

    vec2 pixelSize = vec2(1.f) / resolution;

    vec3 color = vec3(0.f);

    //vec3 pos = vec3(resolution * (vUv * vec2(1.f, -1.f) + vec2(0.f, 1.f)), -10.f);
    vec3 pos = vec3(resolution * vUv, -100.);

    vec3 dir = vec3(0.f, 0.f, 1.f);
    vec3 posOffset;

    for(int i = 0; i < subPixleOffsets.length(); i++) {
        posOffset = pos + vec3(subPixleOffsets[i] * pixelSize, 0.0f);

        color += trace(posOffset, dir);
    }

    color /= float(subPixleOffsets.length());
 
    //color = vec3(vUv, 0.);

    fragColor = vec4(color, 1.f);
}