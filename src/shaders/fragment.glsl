#version 300 es
precision highp float;

#define MAX_OBJECTS 256
#define EPSILON 1e-6

// ╔══════════════════════════════════════════════════════════╗
// ║                       UNIFORMS                           ║
// ╚══════════════════════════════════════════════════════════╝
layout (std140) uniform GeometryBlock {
    vec4 geometryData[MAX_OBJECTS];
};
layout (std140) uniform ShadingBlock {
    vec4 shadingData[MAX_OBJECTS];
};
uniform vec2 resolution;

// ╔══════════════════════════════════════════════════════════╗
// ║              SHADER INPUT, OUTPUT, STRUCTS               ║
// ╚══════════════════════════════════════════════════════════╝
in vec2 vUv;
out vec4 fragColor;

struct Surface {
    vec3 colorDiffuse;
    vec3 colorSpecular;
    vec3 colorAmbient;
    float kd; // diffuse material property
    float ks; // specular material property
    float p; // specular exponent (specular fall off)
    float ka; // ambient material property
    float distance;
};

struct HitInfo {
    int id;
    vec3 pos;
    vec3 normal;
    Surface surface;
};

// ╔══════════════════════════════════════════════════════════╗
// ║                         SDFs                             ║
// ╚══════════════════════════════════════════════════════════╝
float sdSphere(vec3 p, float s) {
    return length(p) - s;
}

float sdBox(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0f)) + min(max(q.x, max(q.y, q.z)), 0.0f);
}

float smin2(float a, float b, float k) { // ret.a = distnce, ret.b = blendfactor
    // return min(a, b);

    k *= 6.0f;
    float h = max(k - abs(a - b), 0.0f) / k;
    float m = h * h * h * 0.5f;
    float s = m * k * (1.0f / 3.0f);
    return (a < b) ? a - s : b - s;
}

vec2 smin(float a, float b, float k) { // ret.a = distnce, ret.b = blendfactor
    // return vec2(min(a, b), a);
    k *= 6.0f;
    float h = max(k - abs(a - b), 0.0f) / k;
    float m = h * h * h * 0.5f;
    float s = m * k * (1.0f / 3.0f);
    return (a < b) ? vec2(a - s, m) : vec2(b - s, 1.0f - m);
}

Surface smin(Surface a, Surface b, float smoothness) {

    vec2 blend = smin(a.distance, b.distance, smoothness);

    return Surface(//
    mix(a.colorDiffuse, b.colorDiffuse, blend.y),//
    mix(a.colorSpecular, b.colorSpecular, blend.y),//
    mix(a.colorAmbient, b.colorAmbient, blend.y),//
    mix(a.kd, b.kd, blend.y),//
    mix(a.ks, b.ks, blend.y),//
    mix(a.p, b.p, blend.y),//
    mix(a.ka, b.ka, blend.y),//
    blend.x);//
}

// ╔══════════════════════════════════════════════════════════╗
// ║                      RAYMARCHING                         ║
// ╚══════════════════════════════════════════════════════════╝
float map(vec3 p) {
    // custom sphere position + radius
    vec3 spherePos = vec3(geometryData[0].xyz);
    float sphereRadius = geometryData[0].w;

    vec3 boxPosition = vec3(0.5f, 0.5f, 0.f);

    float s = sdSphere(p - spherePos, sphereRadius);

    s = smin2(s, sdBox(p - boxPosition, vec3(0.45f, 0.45f, 0.01f)), 0.05f);
    return s;
}

Surface mapWithMaterial(vec3 p) {
    Surface sphereSurface;
    sphereSurface.colorDiffuse = vec3(0.f, 1.f, 1.f);
    sphereSurface.colorSpecular = vec3(1.f);
    sphereSurface.colorAmbient = vec3(1.f, 0.f, 0.f);
    sphereSurface.kd = 1.f; // diffuse material property
    sphereSurface.ks = 1.f; // specular material property
    sphereSurface.p = 20.f; // specular exponent, fall of of specular light
    sphereSurface.ka = 0.1f; // ambient material property

    Surface boxSurface;
    boxSurface.colorDiffuse = vec3(1.f, 0.f, 0.f);
    boxSurface.colorSpecular = vec3(1.f);
    boxSurface.colorAmbient = vec3(1.f, 0.f, 0.f);
    boxSurface.kd = 1.f; // diffuse material property
    boxSurface.ks = 1.f; // specular material property
    boxSurface.p = 20.f; // specular exponent, fall of of specular light
    boxSurface.ka = 0.1f; // ambient material property

    vec3 spherePos = vec3(geometryData[0].xyz);
    float sphereRadius = geometryData[0].w;

    vec3 boxPosition = vec3(0.5f, 0.5f, 0.f);

    sphereSurface.distance = sdSphere(p - spherePos, sphereRadius);
    boxSurface.distance = sdBox(p - boxPosition, vec3(0.45f, 0.45f, 0.01f));

    return smin(sphereSurface, boxSurface, 0.05f);
}

vec3 calcNormal(in vec3 pos) {
    const float eps = 1e-1f;
    const vec2 h = vec2(eps, 0.f);
    return normalize(vec3(map(pos + h.xyy) - map(pos - h.xyy), map(pos + h.yxy) - map(pos - h.yxy), map(pos + h.yyx) - map(pos - h.yyx)));
}

// https://iquilezles.org/articles/normalsSDF/
vec3 calcNormalTetrahedron(vec3 p) {
    // TODO: if perspective camera, make h dependent on the distance to the camera (pixel size)
    //const float h = 0.1f;
    float h = max(0.0005f, 0.0005f * length(p));  // adapt with distance

    const vec2 k = vec2(1, -1);
    return normalize(k.xyy * map(p + k.xyy * h) +
        k.yyx * map(p + k.yyx * h) +
        k.yxy * map(p + k.yxy * h) +
        k.xxx * map(p + k.xxx * h));
}

HitInfo trace(vec3 ro, vec3 rd) {
    const float tMax = 100000.0f;
    const int maxSteps = 128;

    float t = 0.0f;   // distance traveled along ray

    for (int i = 0; i < maxSteps; i++) {

        vec3 p = ro + rd * t;   // current sample position
        float d = map(p);       // distance to nearest surface

        if (d < EPSILON) {
            // hit — return a basic color (white)
            Surface surface = mapWithMaterial(p);
            vec3 normal = calcNormalTetrahedron(p);

            return HitInfo(i > 10 ? -2 : 1, p, normal, surface);
            //return vec3(1.0f);
        }

        t += d;

        if (t > tMax)
            break;
    }

    // miss — return background
    return HitInfo(-1, vec3(0.0f), vec3(0.f, 0.f, 0.f), Surface(vec3(0.f), vec3(0.f), vec3(0.f), 0.f, 0.f, 0.f, 0.f, 0.f));
}

// ╔══════════════════════════════════════════════════════════╗
// ║                         SHADING                          ║
// ╚══════════════════════════════════════════════════════════╝
float shadow(in vec3 ro, in vec3 rd, float mint, float maxt) {
    float t = mint;
    for (int i = 0; i < 256 && t < maxt; i++) {
        float h = map(ro + rd * t);
        if (h < EPSILON)
            return 0.0f;
        t += h;
    }
    return 1.0f;
}

// https://iquilezles.org/articles/rmshadows
float softshadow(in vec3 ro, in vec3 rd, float mint, float maxt, float w) {
    float res = 1.0f;
    float t = mint;
    for (int i = 0; i < 256 && t < maxt; i++) {
        float h = map(ro + t * rd);
        res = min(res, h / (w * t));
        t += clamp(h, 0.005f, 0.50f);
        if (res < -1.0f || t > maxt)
            break;
    }
    res = max(res, -1.0f);
    return 0.25f * (1.0f + res) * (1.0f + res) * (2.0f - res);
}

vec3 shade(HitInfo hit) {
    if (hit.id == -1) {
        return vec3(0.f);
    }
    /* if (hit.id == -2) {
        return vec3(1.f, 0.f, 1.f);
    }
 */
    const vec3 sundir = normalize(vec3(1.f, 1.f, 0.5f));

    Surface surface = hit.surface;

    float ld = 1.f; // diffuse light intensity (light source dependent)
    float la = 1.f; // ambient light intensity (constant for scene)
    float ls = 1.f; // specular light intensity (light source dependent)

    float iDiffuse = surface.kd * ld * max(0.f, dot(-sundir, hit.normal));
    float iAmbient = surface.ka * la;
    float iSpecular = surface.ks * ls * pow(max(0.f, dot(reflect(sundir, hit.normal), vec3(0.f, 0.f, -1.f))), surface.p);

    //float shadow = shadow(hit.pos, -sundir, 0.001f, 5.f);
    float shadow = softshadow(hit.pos, -sundir, 0.001f, 5.f, .05f);
    //float shadow = 1.;

    //return vec3(shadow);
    //return hit.id != -1 ? vec3(1.f) : vec3(0.f);
    return shadow * (iDiffuse * surface.colorDiffuse + iSpecular * surface.colorSpecular) + iAmbient * surface.colorAmbient;
}

// ╔══════════════════════════════════════════════════════════╗
// ║                           MAIN                           ║
// ╚══════════════════════════════════════════════════════════╝
void main(void) {
    //fragColor = length(vUv - geometryData[0].xy) < 0.1f ? vec4(1.f, 0.f, 0.f, 1.f) : vec4(1.f);
    //const vec2 subPixleOffsets[] = vec2[](vec2(0.375f, 0.125f) - vec2(0.5f), vec2(0.875f, 0.375f) - vec2(0.5f), vec2(0.125f, 0.625f) - vec2(0.5f), vec2(0.625f, 0.875f) - vec2(0.5f));
    const vec2 subPixleOffsets[] = vec2[](vec2(0.f, 0.f));
    vec2 pixelSize = vec2(1.f) / resolution.x;

    vec3 color = vec3(0.f);

    vec3 pos = vec3(vUv * vec2(1.f, resolution.y / resolution.x), -1.f);
    vec3 dir = vec3(0.f, 0.f, 1.f);
    vec3 posOffset;

    for (int i = 0; i < subPixleOffsets.length(); i++) {
        posOffset = pos + vec3(subPixleOffsets[i] * pixelSize, 0.0f);

        color += shade(trace(posOffset, dir));
    }

    color /= float(subPixleOffsets.length());

    //color = vec3(vUv, 0.);

    fragColor = vec4(color, 1.f);
    //fragColor = vec4(length(pos.xy) < .1f ? 1.f : 0.f, 0.f, 0.f, 1.f);
}