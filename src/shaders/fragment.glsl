#version 300 es
precision highp float;

#insert DEFINES

#define MAX_NUM_COMMANDS 1024
#define MAX_SIZE_ELEMENT_BUFFER 1024
#define MAX_NUM_LIGHTS 128
#define VEC4_PER_LIGHT 3
#define EPSILON 1e-4
#define MAX_FLOAT 3.402823466e+38f
#define ZERO (min(uNumCommands,0)) // non-constant zero to avoid inlining of functions

// ╔══════════════════════════════════════════════════════════╗
// ║                       UNIFORMS                           ║
// ╚══════════════════════════════════════════════════════════╝
layout (std140) uniform CommandBlock {
    ivec4 commandData[MAX_NUM_COMMANDS];
};
layout (std140) uniform GeometryBlock {
    vec4 geometryData[MAX_SIZE_ELEMENT_BUFFER];
};
layout (std140) uniform ShadingBlock {
    vec4 shadingData[MAX_SIZE_ELEMENT_BUFFER];
};
layout (std140) uniform LightBlock {
    vec4 lightData[MAX_NUM_LIGHTS * VEC4_PER_LIGHT];
};

uniform int uNumCommands;
uniform int uNumLights;

uniform vec2 uResolution;
uniform float uTopOffset;
uniform float uLeftOffset;
uniform float uWindowWidth;
uniform float uWindowHeight;
uniform float uCameraZ;

// Uniforms for the Glyph Texture
uniform highp sampler2DArray uSdfArray;
uniform vec2 uBoxMin;
uniform vec2 uBoxMax;

// ╔══════════════════════════════════════════════════════════╗
// ║              SHADER INPUT, OUTPUT, STRUCTS               ║
// ╚══════════════════════════════════════════════════════════╝
in vec2 vUv;
out vec4 fragColor;

struct Surface { // packed to vec4
    vec3 colorDiffuse;
    float kd; // diffuse material property
    vec3 colorSpecular;
    float ks; // specular material property
    vec3 colorAmbient;
    float ka; // ambient material property
    float p; // specular exponent (specular fall off)
    float mix; // mix factor
    float distance;
};

struct HitInfo {
    vec3 pos;
    int id;
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

float sdCappedCylinder(vec3 p, float r, float h) {
    vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
    return min(max(d.x, d.y), 0.0f) + length(max(d, 0.0f));
}

float sdTriangle(in vec2 p, in vec2 p0, in vec2 p1, in vec2 p2) {
    vec2 e0 = p1 - p0;
    vec2 e1 = p2 - p1;
    vec2 e2 = p0 - p2;

    vec2 v0 = p - p0;
    vec2 v1 = p - p1;
    vec2 v2 = p - p2;

    vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0f, 1.0f);
    vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0f, 1.0f);
    vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0f, 1.0f);

    float s = sign(e0.x * e2.y - e0.y * e2.x);
    vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                     vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                     vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
    return -sqrt(d.x) * sign(d.y);
}

#define CUSTOM_ELEMENT_FUNCTION(functionName, pointsArray)                       \
float functionName(in vec2 p) {                                                  \
    vec2 vec[] = pointsArray;                                                    \
    const int N = vec.length();                                                  \
    float d = dot(p - vec[0], p - vec[0]);                                       \
    float s = 1.0;                                                               \
    for(int i = 0, j = N - 1; i < N; j = i, i++) {                               \
        vec2 e = vec[j] - vec[i];                                                \
        vec2 w = p - vec[i];                                                     \
        vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);                 \
        d = min(d, dot(b, b));                                                   \
        bvec3 c = bvec3(p.y >= vec[i].y, p.y < vec[j].y, e.x * w.y > e.y * w.x); \
        if(all(c) || all(not(c))) {                                              \
            s *= -1.0;                                                           \
        }                                                                        \
    }                                                                            \
    return s * sqrt(d);                                                          \
}

#insert CUSTOM_ELEMENTS_FUNCTIONS

// ╔══════════════════════════════════════════════════════════╗
// ║                    SDF OPERATIONS                        ║
// ╚══════════════════════════════════════════════════════════╝
float opExtrusion(in vec3 p, in float sdf, in float h) {
    // https://iquilezles.org/articles/distfunctions
    vec2 w = vec2(sdf, abs(p.z) - h);
    return min(max(w.x, w.y), 0.0f) + length(max(w, 0.0f));
}

float opRound(in float primitive, in float rad) {
    return primitive - rad;
}

vec3 opTwist(vec3 p, vec3 axis, float k) {
    axis = normalize(axis);
    
    float distAlongAxis = dot(p, axis);
    float angle = k * distAlongAxis;
    
    float c = cos(angle);
    float s = sin(angle);
    
    // Rotate the point around the arbitrary axis using Rodrigues' formula
    vec3 twistedPos = p * c + cross(axis, p) * s + axis * distAlongAxis * (1.0f - c);
    return twistedPos;
}

// ╔══════════════════════════════════════════════════════════╗
// ║                 SDF COMBINING OPERATIONS                 ║
// ╚══════════════════════════════════════════════════════════╝
vec2 smin(float a, float b, float k) { // cubic polynomial (see: https://iquilezles.org/articles/smin/)
    k *= 6.0f;
    float h = max(k - abs(a - b), 0.0f) / k;
    float m = h * h * h * 0.5f;
    float s = m * k * (1.0f / 3.0f);
    return (a < b) ? vec2(a - s, m) : vec2(b - s, 1.0f - m);  // ret.a = distance, ret.b = blendfactor
}

Surface opUnion(Surface a, Surface b) {
    float t = a.distance < b.distance ? 0.f : 1.f;

    return Surface(
        mix(a.colorDiffuse, b.colorDiffuse, t),
        mix(a.kd, b.kd, t),
        mix(a.colorSpecular, b.colorSpecular, t),
        mix(a.ks, b.ks, t),
        mix(a.colorAmbient, b.colorAmbient, t),
        mix(a.ka, b.ka, t),
        mix(a.p, b.p, t),
        t,
        min(a.distance, b.distance)
    );
}

Surface opSubtraction(Surface a, Surface b) {
    float t = a.distance > -b.distance ? 0.f : 1.f;

    return Surface(
        mix(a.colorDiffuse, b.colorDiffuse, t),
        mix(a.kd, b.kd, t), 
        mix(a.colorSpecular, b.colorSpecular, t), 
        mix(a.ks, b.ks, t), 
        mix(a.colorAmbient, b.colorAmbient, t), 
        mix(a.ka, b.ka, t), 
        mix(a.p, b.p, t), 
        t, 
        max(a.distance, -b.distance)
    ); 
}

Surface opIntersection(Surface a, Surface b) {
    float t = a.distance > b.distance ? 0.f : 1.f;

    return Surface(
        mix(a.colorDiffuse, b.colorDiffuse, t),
        mix(a.kd, b.kd, t), 
        mix(a.colorSpecular, b.colorSpecular, t), 
        mix(a.ks, b.ks, t), 
        mix(a.colorAmbient, b.colorAmbient, t), 
        mix(a.ka, b.ka, t), 
        mix(a.p, b.p, t), 
        t, 
        max(a.distance, b.distance)
    ); 
}

Surface opXor(Surface a, Surface b) {
    float dist = max(min(a.distance, b.distance), -max(a.distance, b.distance));
    float t = dist == a.distance ? 0.f : 1.f;

    return Surface(
        mix(a.colorDiffuse, b.colorDiffuse, t),
        mix(a.kd, b.kd, t), 
        mix(a.colorSpecular, b.colorSpecular, t), 
        mix(a.ks, b.ks, t), 
        mix(a.colorAmbient, b.colorAmbient, t), 
        mix(a.ka, b.ka, t), 
        mix(a.p, b.p, t), 
        t, 
        dist
    ); 
}

float opSmoothUnion(float a, float b, float smoothness) {
    return smin(a, b, smoothness).x;
}

Surface opSmoothUnion(Surface a, Surface b, float smoothness) {
    vec2 blend = smin(a.distance, b.distance, smoothness);

    return Surface(
        mix(a.colorDiffuse, b.colorDiffuse, blend.y),
        mix(a.kd, b.kd, blend.y),
        mix(a.colorSpecular, b.colorSpecular, blend.y),
        mix(a.ks, b.ks, blend.y),
        mix(a.colorAmbient, b.colorAmbient, blend.y),
        mix(a.ka, b.ka, blend.y),
        mix(a.p, b.p, blend.y),
        blend.y,
        blend.x
    );
}

Surface opSmoothSubtraction(Surface a, Surface b, float smoothness) {
    vec2 blend = smin(-a.distance, b.distance, smoothness);
    blend.x *= -1.0f;

    return Surface(
        mix(a.colorDiffuse, b.colorDiffuse, blend.y),
        mix(a.kd, b.kd, blend.y),
        mix(a.colorSpecular, b.colorSpecular, blend.y),
        mix(a.ks, b.ks, blend.y),
        mix(a.colorAmbient, b.colorAmbient, blend.y),
        mix(a.ka, b.ka, blend.y),
        mix(a.p, b.p, blend.y),
        blend.y,
        blend.x
    );
}

Surface opSmoothIntersection(Surface a, Surface b, float smoothness) {
    vec2 blend = smin(-a.distance, -b.distance, smoothness);
    blend.x *= -1.0f;

    return Surface(
        mix(a.colorDiffuse, b.colorDiffuse, blend.y),
        mix(a.kd, b.kd, blend.y),
        mix(a.colorSpecular, b.colorSpecular, blend.y),
        mix(a.ks, b.ks, blend.y),
        mix(a.colorAmbient, b.colorAmbient, blend.y),
        mix(a.ka, b.ka, blend.y),
        mix(a.p, b.p, blend.y),
        blend.y,
        blend.x
    );
}

// ╔══════════════════════════════════════════════════════════╗
// ║                      RAYMARCHING                         ║
// ╚══════════════════════════════════════════════════════════╝
vec3 unpackColor(float f) {
    uint u = floatBitsToUint(f);
    return vec3(
        float((u >> 24u) & 255u), 
        float((u >> 16u) & 255u), 
        float((u >> 8u) & 255u)
    ) / 255.0f;
}

void initializeData(inout Surface data) {
    data.colorDiffuse = vec3(0.0f);
    data.colorSpecular = vec3(0.0f);
    data.colorAmbient = vec3(0.0f);
    data.kd = 0.0f; // diffuse material property
    data.ks = 0.0f; // specular material property
    data.p = 0.0f; // specular exponent, fall of of specular light
    data.ka = 0.0f; // ambient material property
    data.distance = MAX_FLOAT;
}

void populateData(inout Surface data, int elementIdx) {
    data.colorDiffuse = unpackColor(shadingData[elementIdx].x);
    data.colorSpecular = unpackColor(shadingData[elementIdx].y);
    data.colorAmbient = unpackColor(shadingData[elementIdx].z);
    data.kd = shadingData[elementIdx].w; // diffuse material property 
    data.ks = shadingData[elementIdx + 1].x; // specular material property 
    data.p = shadingData[elementIdx + 1].y; // specular exponent, fall of of specular light
    data.ka = shadingData[elementIdx + 1].z; // ambient material property
}

float getBakedSDF(int charIndex, vec3 pos, float scale, float depth) {
    float rangeX = uBoxMax.x - uBoxMin.x;
    float rangeY = uBoxMax.y - uBoxMin.y;

    float bakeToWorldRatio = rangeX * scale; // scale is the reciprocal of the size of the texture in world space
    vec2 pBake = vec2(pos.x, -pos.y) * bakeToWorldRatio; // invert y because in the texture the origin is bot-left and in the world top-left
    if (charIndex == 37) { // The '.' is an actual 3d sphere not just an extruded 2d one
        float radius = 22.5f / bakeToWorldRatio;
        return length(pos + vec3(-radius, radius, 0.0f)) - radius; // (length(pBakeMetric - uBoxMin) - 22.5f) / bakeToWorldRatio;
    }

    vec2 pTex = (pBake - uBoxMin) / vec2(rangeX, rangeY); // apply the offset so that the texture's origin lines up and convert to [0..1] range
    vec2 pTexClamped = clamp(pTex, vec2(0.0f), vec2(1.0f));
    float baseDist = textureLod(uSdfArray, vec3(pTexClamped, float(charIndex)), 0.0f).r;

    // Extrapolation (for points outside of the texture)
    vec2 pBakeMetric = pTex * vec2(rangeX, rangeY);
    vec2 pBakeMetricClamped = pTexClamped * vec2(rangeX, rangeY);
    float exteriorDist = length(pBakeMetric - pBakeMetricClamped);

    return opExtrusion(pos, (baseDist + exteriorDist) / bakeToWorldRatio, depth); // convert the distance form glyph-space to world space
}

#define CUSTOM_ELEMENT_IF(functionName, index)                                                                 \
        else if (command == index) {                                                                           \
            float scale = geometryData[elementIdx].x;                                                          \
            float val = functionName(pos.xy * scale) / scale;                                                  \
            current.distance = opExtrusion(pos, val, geometryData[elementIdx].y) - geometryData[elementIdx].z; \
        }                                                                                                      \

Surface map(vec3 p) {
    Surface accumulatedResult; /* fixed size stack */
    initializeData(accumulatedResult);

    int layerOperation = 101; /* persistent layer operation */
    float smoothness = 0.001f; /* persistent smoothness parameter for layerOperations */

    vec3 pos; 
    Surface current; 

    float twistAmount = 5.;

    for (int i = 0; i < uNumCommands; i++) { 
        int command = commandData[i].x; 
        int elementIdx = commandData[i].y; 

        /* commands that don't add to accumulatedSurface */ /* If-else chain due to shorter compile time and ability to use continue */
        if (command >= 200){
            /* Set Layer Data */
            if (command == 200) { 
                layerOperation = floatBitsToInt(geometryData[elementIdx].x);
                smoothness = geometryData[elementIdx].y;
            }
            /* Load Element Matrix and Material */
            if (command == 201) {
                populateData(current, elementIdx);
                mat4 M = mat4(
                    vec4(geometryData[elementIdx].xyz, 0.f),
                    vec4(geometryData[elementIdx].w, geometryData[elementIdx + 1].x, geometryData[elementIdx + 1].y, 0.f),
                    vec4(geometryData[elementIdx + 1].z, geometryData[elementIdx + 1].w, geometryData[elementIdx + 2].x, 0.f),
                    vec4(geometryData[elementIdx + 2].yzw, 1.f)
                );
                pos = (M * vec4(p, 1.0f)).xyz;
            } 
            /* Twist */
            else if (command == 202) {
                vec3 pivot = geometryData[elementIdx].xyz;
                pos -= pivot;
                pos = opTwist(pos, geometryData[elementIdx + 1].xyz, geometryData[elementIdx].w);
                pos += pivot;
            }
            continue;
        }
        /* Sphere */ 
        else if (command == 0) { 
            current.distance = sdSphere(pos, geometryData[elementIdx].x);
        } 
        /* Box Simple */
        else if (command == 1) { 
            current.distance = sdBox(pos, vec3(geometryData[elementIdx].xyz)) - geometryData[elementIdx].w;
        } 
        /* Box (with rounded corners) */
        else if (command == 2) {
            float w = geometryData[elementIdx].x;
            float h = geometryData[elementIdx].y;
            float d = geometryData[elementIdx].z;
            
            float val = sdRoundBox2d(pos.xy, vec2(w, h), geometryData[elementIdx + 1], floatBitsToInt(geometryData[elementIdx + 2].x));
            current.distance = opExtrusion(pos, val, d) - geometryData[elementIdx + 2].y;
        }
        /* Text */
        else if (command == 3) { 
            /* The letters are stored in a TextureArray according to their index */
            int numLetters = floatBitsToInt(geometryData[elementIdx].x);
            float scale = geometryData[elementIdx].y; /* inverse scale */
            float depth = geometryData[elementIdx].z;
            float letterSmoothness = geometryData[elementIdx].w;
        
            float sdValue = getBakedSDF(floatBitsToInt(geometryData[elementIdx + 1].w), pos, scale, depth); /* first letter */
            for (int letterIdx = 1; letterIdx < numLetters; letterIdx++) {
                vec3 letterPos = pos + geometryData[elementIdx + 1 + letterIdx].xyz;
                int letterCode = floatBitsToInt(geometryData[elementIdx + 1 + letterIdx].w);
                sdValue = opSmoothUnion(getBakedSDF(letterCode, letterPos, scale, depth), sdValue, letterSmoothness);
            }
            current.distance = sdValue - geometryData[elementIdx + 1].x;
        }
        /* Cylinder */
        else if (command == 4) {
            current.distance = sdCappedCylinder(pos, geometryData[elementIdx].x, geometryData[elementIdx].y) - geometryData[elementIdx].z;
        }
        /* Triangle */
        else if (command == 5) {
            float val = sdTriangle(pos.xy, geometryData[elementIdx].xy, geometryData[elementIdx].zw, geometryData[elementIdx + 1].xy);
            current.distance = opExtrusion(pos, val, geometryData[elementIdx + 1].z) - geometryData[elementIdx + 1].w;
        }
        /* Custom Elements */
        #insert CUSTOM_ELEMENTS_COMMANDS
        switch (layerOperation) {
            case 100: /* Union */
                accumulatedResult = opUnion(current, accumulatedResult);
                break;
            case 101: /* Subtraction */
                accumulatedResult = opSubtraction(current, accumulatedResult);
                break;
            case 102: /* Intersection */
                accumulatedResult = opIntersection(current, accumulatedResult);
                break;
            case 103: /* Xor */
                accumulatedResult = opXor(current, accumulatedResult);
                break;
            case 104: /* Smooth union */
                accumulatedResult = opSmoothUnion(current, accumulatedResult, smoothness);
                break;
            case 105: /* Smooth subtraction */
                accumulatedResult = opSmoothSubtraction(current, accumulatedResult, smoothness);
                break;
            case 106: /* Smooth intersection */
                accumulatedResult = opSmoothIntersection(current, accumulatedResult, smoothness);
                break;
        }
    } 
    return accumulatedResult; 
} 

vec3 calcNormalTetrahedron(vec3 p) {
    // https://iquilezles.org/articles/normalsSDF/
    const float h = 0.0001f;      // replace by an appropriate value
    vec3 n = vec3(0.0f);
    for (int i = 0; i < 4; i++) {
        vec3 e = 0.5773f * (2.0f * vec3((((i + 3) >> 1) & 1), ((i >> 1) & 1), (i & 1)) - 1.0f);
        n += e * map(p + e * h).distance;
    }
    return normalize(n);
}

HitInfo trace(vec3 ro, vec3 rd) {
    // adapted from Accelerating Sphere Tracing 
    // https://diglib.eg.org/server/api/core/bitstreams/7537a378-9a0a-4ef4-b57d-877322b1441e/content    
    float omega = 1.2f;
    float t = 0.0f;
    float pixelRadius = EPSILON;
    float tMax = 100.0f;

    float rLast = 0.0f;
    float rCurr = 0.1f; // map(ro).distance; to reduce compilation time, because map() gets inlined
    float dPrev = 0.0f;

    float lowerBound = 0.001f; // lower bound for the stepsize when raymarching
    float upperBound = 0.01f; // upper bound for the stepsize when raymarching
    float lowerDistance = EPSILON; // distance at which stepsize = lowerBound
    float upperDistance = 0.01f; // distance at which stepsize = upperBound

    int directionalDerivativeZero = 0;

    for (int i = 0; i < 200; i++) {
        // Intersection found if raymarching
        bool raymarchingIntersection = rCurr < 0.0f;
        if (raymarchingIntersection) {
            float tLower = t - dPrev;
            float tUpper = t;
            float mid = 0.0f;

            for (int j = 0; j < 5; j++) {
                mid = (tLower + tUpper) * 0.5f;
                float sdfMid = map(ro + mid * rd).distance;
                if (abs(sdfMid) < pixelRadius) {
                    break;
                }
                if (sdfMid < 0.0f) {
                    tUpper = mid;
                } else {
                    tLower = mid;
                }
            }
            // vec3 p = ro + t * rd;
            // return HitInfo(i, p, calcNormalTetrahedron(p), map(p));
        }

        // Hit condition
        if (raymarchingIntersection || rCurr < pixelRadius) {
            vec3 p = ro + t * rd;
            return HitInfo(p, i, calcNormalTetrahedron(p), map(p));
        }

        if (t >= tMax) {
            vec3 p = ro + t * rd;
            break;
        }

        float dNext = rCurr;
        float denom = dPrev + rLast - rCurr;

        if (i > 0 && denom > EPSILON) {
            dNext = rCurr + omega * rCurr * (dPrev - rLast + rCurr) / denom;
        }

        // Detect parallel rays 
        if (rCurr < upperDistance && abs(rCurr - rLast) < EPSILON) {
            directionalDerivativeZero++;
        } else {
            directionalDerivativeZero = 0;
        }

        bool isParallel = directionalDerivativeZero >= 5;

        if (isParallel) {
            float tFactor = clamp((rCurr - lowerDistance) / (upperDistance - lowerDistance), 0.0f, 1.0f);
            float minStep = mix(lowerBound, upperBound, tFactor);
            // Allow over-relaxation to take a larger step if possible, but enforce minimum step
            dNext = max(dNext, minStep);
        }

        float rNext = map(ro + (t + dNext) * rd).distance;

        // Overrelaxation was too big (only in the case where we don't do raymarching)
        if (!isParallel && dNext > rCurr + rNext) {
            dNext = rCurr;
            rNext = map(ro + (t + dNext) * rd).distance;
        }

        t += dNext;
        dPrev = dNext;
        rLast = rCurr;
        rCurr = rNext;
    }

    return HitInfo(vec3(0.0f), -1, vec3(0.0f), Surface(vec3(0.0f), 0.0f, vec3(0.0f), 0.0f, vec3(0.0f), 0.0f, 0.0f, 0.0f, 0.0f));
}

// ╔══════════════════════════════════════════════════════════╗
// ║                         SHADING                          ║
// ╚══════════════════════════════════════════════════════════╝
/* float shadow(in vec3 ro, in vec3 rd, float mint, float maxt) {
    float t = mint;
    for (int i = ZERO; i < 256 && t < maxt; i++) {
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
    for (int i = ZERO; i < 256 && t < maxt; i++) {
        float h = map(ro + t * rd).distance;
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
    for (int i = ZERO; i < 50; i++) {
        float h = map(ro + rd * t).distance;
        res = min(res, k * h / t);
        t += clamp(h, 0.02f, 0.20f);
        if (res < 0.005f || t > tmax)
            break;
    }
    return clamp(res, 0.0f, 1.0f);
}
*/

float gaussian(float x, float mu, float sigma) {
    return exp(-1.0f * ((x - mu) * (x - mu)) / (2.0f * sigma * sigma));
}

struct ColorStop {
    vec3 color;
    float position;
};

#define COLOR_RAMP(colors, factor, finalColor) {                        \
    int index = 0;                                                      \
    for (int i = 0; i < colors.length() - 1; i ++) {                    \
        ColorStop currentColor = colors[i];                             \
        bool isInBetween = currentColor.position <= factor;             \
        index = isInBetween ? i : index;                                \
    }                                                                   \
    ColorStop currentColor = colors[index];                             \
    ColorStop nextColor = colors[index + 1];                            \
    float range = nextColor.position - currentColor.position;           \
    float lerpFactor = (factor - currentColor.position) / range;        \
    finalColor = mix(currentColor.color, nextColor.color, lerpFactor);  \
}                                                                       \

#ifdef CUSTOM_SHADE_FUNCTION

#insert SHADE_FUNCTION

#else // custom shade function

#ifdef TWO_D_MODE
vec3 shade(Surface surface) {
    float sdfValue = surface.distance * 80.0f;

    ColorStop[] colors = ColorStop[](
    //ColorStop(surface.colorDiffuse, 0.000000),
    ColorStop(vec3(0.000000f, 0.000000f, 0.015996f), 0.000000f), ColorStop(vec3(0.008023f, 0.002428f, 0.162029f), 0.300000f), ColorStop(vec3(0.590619f, 0.964686f, 0.428690f), 0.400000f), ColorStop(vec3(0.991102f, 0.031896f, 0.814847f), 0.600000f), ColorStop(vec3(1.000000f, 0.000000f, 0.001821f), 0.800000f), ColorStop(vec3(0.008023f, 0.002428f, 0.162029f), 0.900000f), ColorStop(vec3(0.000000f, 0.000000f, 0.015996f), 1.000000f));
    
    vec3 finalColor;
    COLOR_RAMP(colors, sdfValue, finalColor);
    return vec3(finalColor);
}
#else // 2d mode
vec3 shade(HitInfo hit) {
    /* if (hit.id == -1) {
        return vec3(1., 0., 1.);
    }
    if (hit.id == -2) {
        return vec3(0.,1.,1.);
    }
    if (hit.id < 20) {
        return vec3(0., float(hit.id) / 20., 0.);
    }
    if (hit.id < 50) {
        float val = float(hit.id) / 50.;
        return vec3(val, val, 0.);
    }
    return vec3(1, 0., 0.); */

    /* if (hit.id == -1) {
        return vec3(0);
    } */
    // return hit.surface.colorDiffuse;

    //float mixFactor = gaussian(surface.mix, 0.5f, 0.07f); 

    Surface surface = hit.surface;

    // The view vector used in your original specular calculation
    const vec3 viewDir = vec3(0.0f, 0.0f, 1.0f); 

    // Calculate Ambient Light once, not per light
    float la = 1.0f; // ambient light intensity 
    vec3 resultColor = surface.ka * la * surface.colorAmbient;

    for (int i = 0; i < uNumLights; ++i) {
        int dataIdx = i * VEC4_PER_LIGHT;
        
        vec3 lightPos = lightData[dataIdx].xyz;
        vec3 lightColor = unpackColor(lightData[dataIdx].w);
        
        float lightType = lightData[dataIdx + 1].w; // 0 for point light, 1 for directional light
        vec3 lightDir = lightData[dataIdx + 1].xyz; // only used for directional lights

        float intensity = lightData[dataIdx + 2].x;
        float radius = lightData[dataIdx + 2].y;
        float falloff = 1.5f; // lightData[dataIdx + 2].z;

        // light attenuation for point light (taken from https://lisyarus.github.io/blog/posts/point-light-attenuation.html)
        vec3 pointVec = lightPos - hit.pos;
        float dist = length(pointVec);

        float s = dist / radius;
        float attenuation = 0.0f;
        if (s < 1.0f) {
            float temp = (1.0f - s * s);
            attenuation = (temp * temp) / (1.0f + falloff * s);
        }
        float finalAtt = mix(attenuation, 1.0f, lightType);
        vec3 finalLightEnergy = lightColor * intensity * finalAtt;

        // If type == 0.0 (Point), rawVec becomes (lightPos - hit.pos)
        // If type == 1.0 (Directional), rawVec becomes -lightDir 
        vec3 rawVec = mix(lightPos - hit.pos, -lightDir, lightType);
        vec3 vecToLight = normalize(rawVec);
        vec3 vecFromLight = -vecToLight;

        // Diffuse
        float iDiffuse = max(0.0f, dot(vecToLight, hit.normal));
        vec3 diffuse = surface.kd * iDiffuse * surface.colorDiffuse;
        
        // Specular (Phong)
        vec3 reflection = reflect(vecFromLight, hit.normal);
        float iSpecular = pow(max(0.0f, dot(reflection, viewDir)), surface.p);
        vec3 specular = surface.ks * iSpecular * surface.colorSpecular;
        
        // Specular (Blinn-Phong) alternative
        // vec3 halfDir = normalize(vecToLight + viewDir);
        // float specFactor = pow(max(0.0f, dot(hit.normal, halfDir)), 10.0f * surface.p);
        // vec3 specular = surface.ks * specFactor * surface.colorSpecular;

        resultColor += (diffuse + specular) * finalLightEnergy;
    }

    return resultColor;
}
#endif // 2d mode
#endif // custom shade function

// ╔══════════════════════════════════════════════════════════╗
// ║                          MAIN                            ║
// ╚══════════════════════════════════════════════════════════╝
void main(void) {
/*     fragColor = vec4(lightData[0].xyz, 1.0);
    return; */

    vec2 uv = vUv; // origin = top left
    uv *= vec2(uWindowWidth, uWindowHeight);
    uv += vec2(uLeftOffset, uTopOffset);

    vec3 pos = vec3(uv, uCameraZ);
    vec3 dir = vec3(0.0f, 0.0f, -1.0f);

    vec3 color = vec3(0.0f);

#ifdef AA // Anti aliasing
    const vec2 subPixleOffsets[] = vec2[](vec2(0.375f, 0.125f) - vec2(0.5f), vec2(0.875f, 0.375f) - vec2(0.5f), vec2(0.125f, 0.625f) - vec2(0.5f), vec2(0.625f, 0.875f) - vec2(0.5f));
    vec2 pixelSize = vec2(1.0f) / uResolution.x;

    for (int i = 0; i < subPixleOffsets.length(); i++) {
        vec3 posOffset = pos + vec3(subPixleOffsets[0] * pixelSize, 0.0f);

        #ifdef TWO_D_MODE
        Surface currentSurface = map(posOffset);
        #else // 2d mode
        posOffset.z = 0.0f;
        HitInfo currentSurface = trace(posOffset, dir);
        #endif // 2d mode

        color += shade(currentSurface);
    }
    color /= float(subPixleOffsets.length());
#else // Anti-aliasing

    #ifdef TWO_D_MODE
    pos.z = 0.0f;
    Surface currentSurface = map(pos);
    #else // 2d mode
    HitInfo currentSurface = trace(pos, dir);
    #endif // 2d mode

    color = shade(currentSurface);
#endif // Anti-aliasing

    fragColor = vec4(color, 1.0f);
}