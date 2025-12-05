#version 300 es
precision highp float;

#define MAX_SIZE_ELEMENT_BUFFER 512
#define MAX_LAYERS 16
#define EPSILON 1e-6

// ╔══════════════════════════════════════════════════════════╗
// ║                       UNIFORMS                           ║
// ╚══════════════════════════════════════════════════════════╝
layout (std140) uniform GeometryBlock {
    vec4 geometryData[MAX_SIZE_ELEMENT_BUFFER];
};
layout (std140) uniform ShadingBlock {
    vec4 shadingData[MAX_SIZE_ELEMENT_BUFFER];
};

uniform vec2 uResolution;
uniform float uTopOffset;
uniform float uLeftOffset;
uniform float uWindowWidth;
uniform float uWindowHeight;

uniform float uCameraZ;

uniform int uLayerOperations[MAX_LAYERS];
uniform int uElementsInLayer[MAX_LAYERS];
uniform float uSmoothingFactors[MAX_LAYERS];
uniform int uNumLayers;

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
    float mix; // mix factor
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

float sdRoundBox(vec3 p, vec3 b, float r) {
    vec3 q = abs(p) - b + r;
    return length(max(q, 0.0f)) + min(max(q.x, max(q.y, q.z)), 0.0f) - r;
}

float sdCornerCircle(in vec2 uv) {
    return length(uv - vec2(0.0f, -1.0f)) - sqrt(2.0f);
}

float sdCornerParabola(in vec2 uv) {
    // https://www.shadertoy.com/view/ws3GD7
    float y = (0.5f + uv.y) * (2.0f / 3.0f);
    float h = uv.x * uv.x + y * y * y;
    float w = pow(uv.x + sqrt(abs(h)), 1.0f / 3.0f);
    float x = w - y / w;
    vec2 q = vec2(x, 0.5f * (1.0f - x * x));
    return length(uv - q) * sign(uv.y - q.y);
}

const float kT = 6.28318531f;

float sdCornerCosine(in vec2 uv) {
    // https://www.shadertoy.com/view/3t23WG
    uv *= (kT / 4.0f);

    float ta = 0.0f, tb = kT / 4.0f;
    for (int i = 0; i < 8; i++) {
        float t = 0.5f * (ta + tb);
        float y = t - uv.x + sin(t) * (uv.y - cos(t));
        if (y < 0.0f)
            ta = t;
        else
            tb = t;
    }
    vec2 qa = vec2(ta, cos(ta)), qb = vec2(tb, cos(tb));
    vec2 pa = uv - qa, di = qb - qa;
    float h = clamp(dot(pa, di) / dot(di, di), 0.0f, 1.0f);
    return length(pa - di * h) * sign(pa.y * di.x - pa.x * di.y) * (4.0f / kT);
}

float sdCornerCubic(in vec2 uv) {
    float ta = 0.0f, tb = 1.0f;
    for (int i = 0; i < 12; i++) {
        float t = 0.5f * (ta + tb);
        float c = (t * t * (t - 3.0f) + 2.0f) / 3.0f;
        float dc = t * (t - 2.0f);
        float y = (uv.x - t) + (uv.y - c) * dc;
        if (y > 0.0f)
            ta = t;
        else
            tb = t;
    }
    vec2 qa = vec2(ta, (ta * ta * (ta - 3.0f) + 2.0f) / 3.0f);
    vec2 qb = vec2(tb, (tb * tb * (tb - 3.0f) + 2.0f) / 3.0f);
    vec2 pa = uv - qa, di = qb - qa;
    float h = clamp(dot(pa, di) / dot(di, di), 0.0f, 1.0f);
    return length(pa - di * h) * sign(pa.y * di.x - pa.x * di.y);
}

float sdRoundBox2d(in vec2 p, in vec2 b, in vec4 r, int type) {
    // select corner radius
    r.xy = (p.x > 0.0f) ? r.xy : r.zw;
    r.x = (p.y > 0.0f) ? r.x : r.y;

    // box coordinates
    vec2 q = abs(p) - b + r.x;

    // distance to sides
    if (min(q.x, q.y) < 0.0f)
        return max(q.x, q.y) - r.x;

    // rotate 45 degrees, offset by r and scale by r*sqrt(0.5)
    // to canonical corner coordinates
    r.x = max(EPSILON, r.x);
    vec2 uv = vec2(abs(q.x - q.y), q.x + q.y - r.x) / r.x;

    // compute distance to corner shape
    float d;
    if (type == 0)
        d = sdCornerCircle(uv);
    else if (type == 1)
        d = sdCornerParabola(uv);
    else if (type == 2)
        d = sdCornerCosine(uv);
    else if (type == 3)
        d = sdCornerCubic(uv);
    // undo scale
    return d * r.x * sqrt(0.5f);
}

float smin2(float a, float b, float k) { // ret.a = distnce, ret.b = blendfactor
    k *= 6.0f;
    float h = max(k - abs(a - b), 0.0f) / k;
    float m = h * h * h * 0.5f;
    float s = m * k * (1.0f / 3.0f);
    return (a < b) ? a - s : b - s;
}

// ╔══════════════════════════════════════════════════════════╗
// ║                    SDF OPERATIONS                        ║
// ╚══════════════════════════════════════════════════════════╝
float opExtrusion(in vec3 p, in float sdf, in float h) {
    // https://iquilezles.org/articles/distfunctions
    vec2 w = vec2(sdf, abs(p.z) - h);
    return min(max(w.x, w.y), 0.0f) + length(max(w, 0.0f));
}

// ╔══════════════════════════════════════════════════════════╗
// ║                 SDF COMBINING OPERATIONS                 ║
// ╚══════════════════════════════════════════════════════════╝
vec2 smin(float a, float b, float k) { // ret.a = distnce, ret.b = blendfactor //return vec2(min(a, b), a);
    k *= 6.0f;
    float h = max(k - abs(a - b), 0.0f) / k;
    float m = h * h * h * 0.5f;
    float s = m * k * (1.0f / 3.0f);
    return (a < b) ? vec2(a - s, m) : vec2(b - s, 1.0f - m);
}

Surface opUnion(Surface a, Surface b) {
    float t = a.distance < b.distance ? 0.f : 1.f;

    return Surface(//
    mix(a.colorDiffuse, b.colorDiffuse, t),//
    mix(a.colorSpecular, b.colorSpecular, t),//
    mix(a.colorAmbient, b.colorAmbient, t),//
    mix(a.kd, b.kd, t),//
    mix(a.ks, b.ks, t),//
    mix(a.p, b.p, t),//
    mix(a.ka, b.ka, t),//
    t,//
    a.distance < b.distance ? a.distance : b.distance);//
}

Surface opSubtraction(Surface a, Surface b) {
    float t = a.distance > -b.distance ? 0.f : 1.f;

    return Surface(mix(a.colorDiffuse, b.colorDiffuse, t),//
    mix(a.colorSpecular, b.colorSpecular, t), //
    mix(a.colorAmbient, b.colorAmbient, t), //
    mix(a.kd, b.kd, t), //
    mix(a.ks, b.ks, t), //
    mix(a.p, b.p, t), //
    mix(a.ka, b.ka, t), //
    t, //
    max(a.distance, -b.distance)); //
}

Surface opIntersection(Surface a, Surface b) {
    float t = a.distance > b.distance ? 0.f : 1.f;

    return Surface(mix(a.colorDiffuse, b.colorDiffuse, t),//
    mix(a.colorSpecular, b.colorSpecular, t), //
    mix(a.colorAmbient, b.colorAmbient, t), //
    mix(a.kd, b.kd, t), //
    mix(a.ks, b.ks, t), //
    mix(a.p, b.p, t), //
    mix(a.ka, b.ka, t), //
    t, //
    max(a.distance, b.distance)); //
}

Surface opXor(Surface a, Surface b) {
    float dist = max(min(a.distance, b.distance), -max(a.distance, b.distance));
    float t = dist == a.distance ? 0.f : 1.f;

    return Surface(mix(a.colorDiffuse, b.colorDiffuse, t),//
    mix(a.colorSpecular, b.colorSpecular, t), //
    mix(a.colorAmbient, b.colorAmbient, t), //
    mix(a.kd, b.kd, t), //
    mix(a.ks, b.ks, t), //
    mix(a.p, b.p, t), //
    mix(a.ka, b.ka, t), //
    t, //
    dist); //
}

Surface opSmoothUnion(Surface a, Surface b, float smoothness) {
    vec2 blend = smin(a.distance, b.distance, smoothness);

    return Surface(//
    mix(a.colorDiffuse, b.colorDiffuse, blend.y),//
    mix(a.colorSpecular, b.colorSpecular, blend.y),//
    mix(a.colorAmbient, b.colorAmbient, blend.y),//
    mix(a.kd, b.kd, blend.y),//
    mix(a.ks, b.ks, blend.y),//
    mix(a.p, b.p, blend.y),//
    mix(a.ka, b.ka, blend.y),//
    blend.y,//
    blend.x);//
}

Surface opSmoothSubtraction(Surface a, Surface b, float smoothness) {
    vec2 blend = smin(-a.distance, b.distance, smoothness);
    blend.x *= -1.f;

    return Surface(//
    mix(a.colorDiffuse, b.colorDiffuse, blend.y),//
    mix(a.colorSpecular, b.colorSpecular, blend.y),//
    mix(a.colorAmbient, b.colorAmbient, blend.y),//
    mix(a.kd, b.kd, blend.y),//
    mix(a.ks, b.ks, blend.y),//
    mix(a.p, b.p, blend.y),//
    mix(a.ka, b.ka, blend.y),//
    blend.y,//
    blend.x);//
}

Surface opSmoothIntersection(Surface a, Surface b, float smoothness) {
    vec2 blend = smin(-a.distance, -b.distance, smoothness);
    blend.x *= -1.f;

    return Surface(//
    mix(a.colorDiffuse, b.colorDiffuse, blend.y),//
    mix(a.colorSpecular, b.colorSpecular, blend.y),//
    mix(a.colorAmbient, b.colorAmbient, blend.y),//
    mix(a.kd, b.kd, blend.y),//
    mix(a.ks, b.ks, blend.y),//
    mix(a.p, b.p, blend.y),//
    mix(a.ka, b.ka, blend.y),//
    blend.y,//
    blend.x);//
}

// ╔══════════════════════════════════════════════════════════╗
// ║                      RAYMARCHING                         ║
// ╚══════════════════════════════════════════════════════════╝
/* vec4 unpackColor(float f) {
    // reinterpret float bits as uint
    uint u = floatBitsToUint(f);

    float r = float((u >> 24u) & 0xFFu) / 255.0f;
    float g = float((u >> 16u) & 0xFFu) / 255.0f;
    float b = float((u >> 8u) & 0xFFu) / 255.0f;
    float a = float(u & 0xFFu) / 255.0f;

    return vec4(r, g, b, a);
} */

vec3 unpackColor(float f) {
    uint u = floatBitsToUint(f);
    return vec3(//
    float((u >> 24u) & 255u), //
    float((u >> 16u) & 255u), //
    float((u >> 8u) & 255u) //
    ) / 255.0f;
}

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
    Surface combinedSurface;
    combinedSurface.colorDiffuse = vec3(0.f);
    combinedSurface.colorSpecular = vec3(0.f);
    combinedSurface.colorAmbient = vec3(0.f);
    combinedSurface.kd = 0.f; // diffuse material property
    combinedSurface.ks = 0.f; // specular material property
    combinedSurface.p = 0.f; // specular exponent, fall of of specular light
    combinedSurface.ka = 0.1f; // ambient material property
    combinedSurface.distance = 3.402823466e+38f;

    int elementIdx = 0;

    for (int layer = 0; layer < uNumLayers; layer++) {
        int layerOperation = uLayerOperations[layer];
        int numElements = uElementsInLayer[layer];
        float smoothness = uSmoothingFactors[layer];

        for (int i = 0; i < numElements; i++) {

            Surface surface;
            surface.colorDiffuse = unpackColor(shadingData[elementIdx].x);
            surface.colorSpecular = unpackColor(shadingData[elementIdx].y);
            surface.colorAmbient = unpackColor(shadingData[elementIdx].z);
            surface.kd = shadingData[elementIdx].w; // diffuse material property
            surface.ks = shadingData[elementIdx + 1].x; // specular material property
            surface.p = shadingData[elementIdx + 1].y; // specular exponent, fall of of specular light
            surface.ka = shadingData[elementIdx + 1].z; // ambient material property

            float sdValue;

            mat4 M = mat4( //
            vec4(geometryData[elementIdx].xyz, 0.f), //
            vec4(geometryData[elementIdx].w, geometryData[elementIdx + 1].x, geometryData[elementIdx + 1].y, 0.f), //
            vec4(geometryData[elementIdx + 1].z, geometryData[elementIdx + 1].w, geometryData[elementIdx + 2].x, 0.f), //
            vec4(geometryData[elementIdx + 2].yzw, 1.f)//
            );

            vec3 pos = (M * vec4(p, 1.f)).xyz;

            switch (floatBitsToInt(geometryData[elementIdx + 3].x)) {
                case 0: // Sphere
                    sdValue = sdSphere(pos, geometryData[elementIdx + 3].y);
                    elementIdx += 4;
                    break;
                case 1: // Simple Box
                    sdValue = sdBox(pos, vec3(geometryData[elementIdx + 3].yzw));
                    elementIdx += 4;
                    break;
                case 2: // Box (with optional rounded corners)
                    float val = sdRoundBox2d(pos.xy, geometryData[elementIdx + 3].yz, geometryData[elementIdx + 4], floatBitsToInt(geometryData[elementIdx + 5].x));
                    sdValue = opExtrusion(pos, val, geometryData[elementIdx + 3].w);
                    elementIdx += 6;
                    break;
                case 3: // Round Box
                    sdValue = sdRoundBox(pos, geometryData[elementIdx + 3].yzw, geometryData[elementIdx + 4].x);
                    elementIdx += 5;
                    break;
            }

            surface.distance = sdValue;

            switch (layerOperation) {
                case 0: // Union
                    combinedSurface = opUnion(combinedSurface, surface);
                    break;
                case 1: // Subtraction
                    combinedSurface = opSubtraction(combinedSurface, surface);
                    break;
                case 2: // Intersection
                    combinedSurface = opIntersection(combinedSurface, surface);
                    break;
                case 3: // Xor
                    combinedSurface = opXor(combinedSurface, surface);
                    break;
                case 4: // Smooth union
                    combinedSurface = opSmoothUnion(combinedSurface, surface, smoothness);
                    break;
                case 5: // Smooth subtraction 
                    combinedSurface = opSmoothSubtraction(combinedSurface, surface, smoothness);
                    break;
                case 6: // Smooth intersection
                    combinedSurface = opSmoothIntersection(combinedSurface, surface, smoothness);
                    break;
            }
        }
    }

/*     vec3 pos = geometryData[0].xyz;
    sphereSurface.distance = sdBox(p - pos, geometryData[1].xyz);
 */

/*    vec3 negBoxPos = vec3(geometryData[0].xyz - vec3(0.f, 0.f, 0.3f));
    Surface negBoxSurface;
    negBoxSurface = sphereSurface;
    negBoxSurface.colorDiffuse = vec3(1.f, 0.f, 0.f);
    negBoxSurface.distance = sdRoundBox(p - negBoxPos, vec3(.1f, .1f, .1f), 0.01f); */

    //return opSmoothSubtraction(negBoxSurface, union_, 0.005f);
    return combinedSurface;
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
    return normalize(k.xyy * mapWithMaterial(p + k.xyy * h).distance +
        k.yyx * mapWithMaterial(p + k.yyx * h).distance +
        k.yxy * mapWithMaterial(p + k.yxy * h).distance +
        k.xxx * mapWithMaterial(p + k.xxx * h).distance);
}

HitInfo trace(vec3 ro, vec3 rd) {
    const float tMax = 100.0f;
    const int maxSteps = 128;

    float t = 0.0f;   // distance traveled along ray

    float last = -1.f;
    int howOften = 0;

    for (int i = 0; i < maxSteps; i++) {

        vec3 p = ro + rd * t;   // current sample position
        float d = mapWithMaterial(p).distance;       // distance to nearest surface

        if (abs(d - last) < EPSILON) {
            howOften++;
        }
        last = d;

        if (d < EPSILON || howOften > 1000) {
            // hit — return a basic color (white)
            Surface surface = mapWithMaterial(p);
            vec3 normal = calcNormalTetrahedron(p);

            return HitInfo(i > 20 ? -2 : 1, p, normal, surface);
            //return vec3(1.0f);
        }

        t += d;

        if (t > tMax)
            break;
    }

    // miss — return background
    return HitInfo(-1, vec3(0.0f), vec3(0.f, 0.f, 0.f), Surface(vec3(0.f), vec3(0.f), vec3(0.f), 0.f, 0.f, 0.f, 0.f, 0.f, 0.f));
}

// ╔══════════════════════════════════════════════════════════╗
// ║                         SHADING                          ║
// ╚══════════════════════════════════════════════════════════╝
float shadow(in vec3 ro, in vec3 rd, float mint, float maxt) {
    float t = mint;
    for (int i = 0; i < 256 && t < maxt; i++) {
        float h = mapWithMaterial(ro + rd * t).distance;
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
        float h = mapWithMaterial(ro + t * rd).distance;
        res = min(res, h / (w * t));
        t += clamp(h, 0.005f, 0.50f);
        if (res < -1.0f || t > maxt)
            break;
    }
    res = max(res, -1.0f);
    return 0.25f * (1.0f + res) * (1.0f + res) * (2.0f - res);
}

float calcSoftshadow(in vec3 ro, in vec3 rd, float tmin, float tmax, const float k) {
    float res = 1.0f;
    float t = tmin;
    for (int i = 0; i < 50; i++) {
        float h = mapWithMaterial(ro + rd * t).distance;
        res = min(res, k * h / t);
        t += clamp(h, 0.02f, 0.20f);
        if (res < 0.005f || t > tmax)
            break;
    }
    return clamp(res, 0.0f, 1.0f);
}

float gaussian(float x, float mu, float sigma) {
    return exp(-1.f * ((x - mu) * (x - mu)) / (2.f * sigma * sigma));
}

vec3 shade(HitInfo hit) {
    if (hit.id == -1) {
        return vec3(0.f);
        return vec3(0.f, 1.f, 1.f);
    }
    /* if (hit.id == -2) {
        return vec3(1.f, 0.f, 1.f);
    } */

    const vec3 sundir = normalize(vec3(1.f, -1.f, -1.5f));

    Surface surface = hit.surface;

    float mixFacotr = gaussian(surface.mix, 0.5f, 0.07f);

    float ld = 1.f; // diffuse light intensity (light source dependent)
    float la = 1.f; // ambient light intensity (constant for scene)
    float ls = 1.f; // specular light intensity (light source dependent)

    float iDiffuse = surface.kd * ld * max(0.f, dot(-sundir, hit.normal));
    float iAmbient = surface.ka * la;
    float iSpecular = surface.ks * ls * pow(max(0.f, dot(reflect(sundir, hit.normal), vec3(0.f, 0.f, -1.f))), surface.p);

    //float shadow = shadow(hit.pos, -sundir, 0.001f, 5.f);
    float shadow = softshadow(hit.pos, -sundir, 0.001f, 5.f, 0.1f);
    //float shadow = calcSoftshadow(hit.pos, -sundir, 0.01f, 5.0f, 16.0f);
    shadow = max(shadow, 0.1f);

    //return vec3(shadow);
    //return hit.id != -1 ? vec3(1.f) : vec3(0.f);
    return shadow * (iDiffuse * surface.colorDiffuse + iSpecular * surface.colorSpecular) + iAmbient * surface.colorAmbient;
}

// ╔══════════════════════════════════════════════════════════╗
// ║                           MAIN                           ║
// ╚══════════════════════════════════════════════════════════╝
void main(void) {
    fragColor = vec4(vec3(shadingData[0].w), 1.f);
    //return;

    fragColor = length(vUv - geometryData[0].xy) < 0.1f ? vec4(1.f, 0.f, 0.f, 1.f) : vec4(1.f);
    //return;
    //const vec2 subPixleOffsets[] = vec2[](vec2(0.375f, 0.125f) - vec2(0.5f), vec2(0.875f, 0.375f) - vec2(0.5f), vec2(0.125f, 0.625f) - vec2(0.5f), vec2(0.625f, 0.875f) - vec2(0.5f));
    const vec2 subPixleOffsets[] = vec2[](vec2(0.f, 0.f));
    vec2 pixelSize = vec2(1.f) / uResolution.x;

    vec3 color = vec3(0.f);

    vec2 uv = vUv; // origin = top left
    uv *= vec2(uWindowWidth, uWindowHeight);
    uv += vec2(uLeftOffset, uTopOffset);

    vec3 pos = vec3(uv, uCameraZ);
    vec3 dir = vec3(0.f, 0.f, -1.f);
    vec3 posOffset;

    for (int i = 0; i < subPixleOffsets.length(); i++) {
        posOffset = pos + vec3(subPixleOffsets[i] * pixelSize, 0.0f);

        color += shade(trace(posOffset, dir));
    }

    color /= float(subPixleOffsets.length());

    //color = vec3(vUv, 0.);

    fragColor = vec4(color, 1.f);
    //fragColor = vec4(vUv, 0., 1.);
    //fragColor = vec4(length(pos.xy) < .1f ? 1.f : 0.f, 0.f, 0.f, 1.f);
}