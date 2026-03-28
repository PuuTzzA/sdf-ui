#version 300 es
precision highp float;

#define MAX_SIZE_ELEMENT_BUFFER 512
#define MAX_LAYERS 16
#define EPSILON 1e-4
#define MAX_FLOAT 3.402823466e+38f
#define ZERO (min(uNumLayers,0)) // non-constant zero to avoid inlining of functions

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
uniform bool uTwoDMode;

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

// ╔══════════════════════════════════════════════════════════╗
// ║                     SDF of letters                       ║
// ╚══════════════════════════════════════════════════════════╝
const float d = 45.; // stroke width
const float _h = 365.; // verical length of straight lines that have a halve circe on both sides  (e.g. straight section in c)
const float pi = 3.1415926535897932384626433832795;

vec2 rotate2d(vec2 v, float a) {
    float s = sin(a);
    float c = cos(a);
    mat2 m = mat2(c, s, -s, c);
    return m * v;
}

float smin2d(float a, float b, float k) {
    k *= 1.0 / (1.0 - sqrt(0.5));
    float h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - k * 0.5 * (1.0 + h - sqrt(1.0 - h * (h - 2.0)));
}

float sdCircle2d(vec2 p, float r) {
    return length(p) - r;
}

float sdBox2d(in vec2 p, in vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdRoundedBox2d(in vec2 p, in vec2 b, in vec4 r) {
    r.xy = (p.x > 0.0) ? r.xy : r.zw;
    r.x = (p.y > 0.0) ? r.x : r.y;
    vec2 q = abs(p) - b + r.x;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r.x;
}

float sdRing2d(in vec2 p, in vec2 n, in float r, float th) {
    p.x = abs(p.x);

    p = mat2x2(n.x, n.y, -n.y, n.x) * p;

    return max(abs(length(p) - r) - th * 0.5, length(vec2(p.x, max(0.0, abs(r - p.y) - th * 0.5))) * sign(p.x));
}

float sda(in vec2 p) {
    float a = sdRing2d(p + vec2(d * 1.5, -_h - d * 1.5), vec2(cos(pi / 2.), sin(pi / 2.)), d, d); // ring top
    a = min(sdRoundedBox2d(p + vec2(d / 2., -d * 1.5 - _h + 115. / 2.), vec2(d / 2., 115. / 2.), vec4(0., d / 2., 0., d / 2.)), a);
    a = min(sdBox2d(p + vec2(d * 2.5, -_h / 2. - d * 1.5), vec2(d / 2., _h / 2.)), a); // rectangle right
    a = min(sdRing2d(p + vec2(d * 1.5, -d * 1.5), vec2(cos(pi / -2.), sin(pi / -2.)), d, d), a); // ring bottom
    a = smin2d(sdBox2d(p + vec2(d * 1.75, -137.5 - d * 2.5), vec2(d / 4., d / 2.)), a, d / 8.); // small rectangle middle
    a = min(sdBox2d(p + vec2(d / 2., -137.5 / 2. - d * 1.5), vec2(d / 2., 137.5 / 2.)), a); // rectangle left bottom
    a = min(sdRing2d(rotate2d(p + vec2(d * 1.5, -137.5 - d * 1.5), pi / 4.), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), a); // quarter ring
    return a;
}

float sdb(in vec2 p) {
    float b = sdRing2d(p + vec2(d * 1.5, -d * 1.5), vec2(cos(pi / -2.), sin(pi / -2.)), d, d); // ring bottom
    b = min(sdRoundedBox2d(p + vec2(d / 2., -632.5 / 2. - d * 1.5), vec2(d / 2., 632.5 / 2.), vec4(d / 2., 0., d / 2., 0.)), b); // rectangle left
    b = smin2d(sdBox2d(p + vec2(d * 1.25, -_h - d * 2.5), vec2(d / 4., d / 2.)), b, d / 8.); // small rectangle middle
    b = min(sdBox2d(p + vec2(d * 2.5, -_h / 2. - d * 1.5), vec2(d / 2., _h / 2.)), b); // rectangle left
    b = min(sdRing2d(rotate2d(p + vec2(d * 1.5, -_h - d * 1.5), -pi / 4.), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), b); // quarter ring
    return b;
}

float sdc(in vec2 p) {
    float c = sdRing2d(p + vec2(d * 1.5, -d * 1.5), vec2(cos(pi / -2.), sin(pi / -2.)), d, d); // ring bottom
    c = min(sdBox2d(p + vec2(d / 2., -_h / 2. - d * 1.5), vec2(d / 2., _h / 2.)), c); // rectangle left
    c = min(sdRing2d(p + vec2(d * 1.5, -_h - d * 1.5), vec2(cos(pi / 2.), sin(pi / 2.)), d, d), c); // ring top
    c = min(sdRoundedBox2d(p + vec2(d * 2.5, -d * 2.25), vec2(d / 2., d * 0.75), vec4(d / 2., 0., d / 2., 0.)), c); // box bottom
    c = min(sdRoundedBox2d(p + vec2(d * 2.5, -_h - d * 0.75), vec2(d / 2., d * 0.75), vec4(0., d / 2., 0., d / 2.)), c); // box top
    return c;
}

float sdd(in vec2 p) {
    return sdb(p * vec2(-1., 1.) + vec2(-d * 3., 0.));
}

float sde(in vec2 p) {
    return sda(p * vec2(-1., -1.) + vec2(-d * 3., d * 3. + _h));
}

float sdf(in vec2 p) {
    float f = sdRoundedBox2d(p + vec2(d / 2., -632.5 / 2.), vec2(d / 2., 632.5 / 2.), vec4(0., d / 2., 0., d / 2.)); // rectangle
    f = min(sdRing2d(p + vec2(d * 1.5, -632.5), vec2(cos(pi / 2.), sin(pi / 2.)), d, d), f); // ring top
    f = min(sdRoundedBox2d(p + vec2(d * 2.5, -632.5 + d / 2.), vec2(d / 2., d / 2.), vec4(0., d / 2., 0., d / 2.)), f); // box bottom
    f = smin2d(sdRoundedBox2d(p + vec2(d * 1.5 - d, -545. + d / 2.), vec2(d * 1.5, d / 2.), vec4(d / 2.)), f, d / 8.); // crossbar
    return f;
}

float sdg(in vec2 p) {
    float g = sdRing2d(p + vec2(d * 1.5, -432.5), vec2(cos(pi / 2.), sin(pi / 2.)), d, d); // ring top
    g = min(sdBox2d(p + vec2(d * 2.5, -150.), vec2(d / 2., 565. / 2.)), g); // rectangle right
    g = smin2d(sdBox2d(p + vec2(d * 1.75, -d / 2.), vec2(d / 4., d / 2.)), g, d / 8.); // rectangle bot
    g = min(sdRing2d(rotate2d(p + vec2(d * 1.5, d * -1.5), pi * 0.75), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), g); // quarter ring
    g = min(sdBox2d(p + vec2(d / 2., -_h / 2. - d * 1.5), vec2(d / 2., _h / 2.)), g); // rectangle left
    g = min(sdRing2d(p + vec2(d * 1.5, 132.5), vec2(cos(pi / -2.), sin(pi / -2.)), d, d), g); // ring bottom
    g = min(sdRoundedBox2d(p + vec2(d / 2., 132.5 - d / 2.), vec2(d / 2., d * 0.75), vec4(d / 2., 0., d / 2., 0.)), g); // box bottom
    return g;
}

float sdh(in vec2 p) {
    float h = sdRoundedBox2d(p + vec2(d / 2., -700. / 2.), vec2(d / 2., 700. / 2.), vec4(d / 2.)); // rectangle left
    h = smin2d(sdBox2d(p + vec2(d * 1.25, -_h - d * 2.5), vec2(d / 4., d / 2.)), h, d / 8.); // small rectangle middle
    h = min(sdRoundedBox2d(p + vec2(d * 2.5, -432.5 / 2.), vec2(d / 2., 432.5 / 2.), vec4(0., d / 2., 0., d / 2.)), h); // rectangle left
    h = min(sdRing2d(rotate2d(p + vec2(d * 1.5, -_h - d * 1.5), -pi / 4.), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), h); // quarter ring
    return h;
}

float sdi(in vec2 p) {
    float i = sdRoundedBox2d(p + vec2(d / 2., -250.), vec2(d / 2., 250.), vec4(d / 2.));
    i = min(sdCircle2d(p + vec2(d / 2., -500. - d * 1.5), d / 2.), i);
    return i;
}

float sdj(in vec2 p) {
    float j = sdRoundedBox2d(p + vec2(d / 2., -183.75), vec2(d / 2., 632.5 / 2.), vec4(d / 2., 0., d / 2., 0.));
    j = min(sdRing2d(p + vec2(d * -0.5, 132.5), vec2(cos(pi / -2.), sin(pi / -2.)), d, d), j); // ring bottom
    j = min(sdRoundedBox2d(p + vec2(-d * 1.5, 98.75), vec2(d / 2., d * 0.75), vec4(d / 2., 0., d / 2., 0.)), j); // box bottom
    j = min(sdCircle2d(p + vec2(d / 2., -500. - d * 1.5), d / 2.), j);
    return j;
}

float sdk(in vec2 p) {
    float k = sdRoundedBox2d(p + vec2(d / 2., -350.), vec2(d / 2., 350.), vec4(d / 2.));
    k = smin2d(sdBox2d(p + vec2(d * 1.25, -295. - d), vec2(d / 4., d / 2.)), k, d / 8.);
    k = smin2d(sdBox2d(p + vec2(d * 1.25, -295. + d), vec2(d / 4., d / 2.)), k, d / 8.);
    k = min(sdRoundedBox2d(p + vec2(d * 2.5, -102.5), vec2(d / 2., 102.5), vec4(0., d / 2., 0., d / 2.)), k);
    k = min(sdRing2d(rotate2d(p + vec2(d * 1.5, -137.5 - d * 1.5), pi / -4.), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), k); // quarter ring
    k = min(sdRing2d(rotate2d(p + vec2(d * 1.5, -137.5 - d * 5.5), pi * 1.25), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), k); // quarter ring
    k = min(sdRoundedBox2d(p + vec2(d * 2.5, -385. - 115. / 2.), vec2(d / 2., 115. / 2.), vec4(d / 2., 0., d / 2., 0.)), k);
    return k;
}

float sdl(in vec2 p) {
    return sdRoundedBox2d(p + vec2(d / 2., -350.), vec2(d / 2., 350.), vec4(d / 2.));
}

float sdm(in vec2 p) {
    float m = sdRoundedBox2d(p + vec2(d / 2., -432.5 / 2.), vec2(d / 2., 432.5 / 2.), vec4(0, d / 2., 0., d / 2.));
    m = min(sdBox2d(p + vec2(d * 2.5, -432.5 - d), vec2(d, d * 0.5)), m);
    m = smin2d(sdRoundedBox2d(p + vec2(d * 2.5, -455. / 2.), vec2(d / 2., 455. / 2.), vec4(0, d / 2., 0., d / 2.)), m, d / 8.);
    m = min(sdRing2d(rotate2d(p + vec2(d * 1.5, -432.5), pi / 4.), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), m); // quarter ring
    m = min(sdRing2d(rotate2d(p + vec2(d * 3.5, -432.5), pi / -4.), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), m); // quarter ring
    m = min(sdRoundedBox2d(p + vec2(d * 4.5, -432.5 / 2.), vec2(d / 2., 432.5 / 2.), vec4(0, d / 2., 0., d / 2.)), m);
    return m;
}

float sdn(in vec2 p) {
    float n = sdRoundedBox2d(p + vec2(d / 2., -432.5 / 2.), vec2(d / 2., 432.5 / 2.), vec4(0, d / 2., 0., d / 2.));
    n = min(sdRoundedBox2d(p + vec2(d * 2.5, -432.5 / 2.), vec2(d / 2., 432.5 / 2.), vec4(0, d / 2., 0., d / 2.)), n);
    n = min(sdRing2d(p + vec2(d * 1.5, -_h - d * 1.5), vec2(cos(pi / 2.), sin(pi / 2.)), d, d), n); // ring top
    return n;
}

float sdo(in vec2 p) {
    float c = sdRing2d(p + vec2(d * 1.5, -d * 1.5), vec2(cos(pi / -2.), sin(pi / -2.)), d, d); // ring bottom
    c = min(sdBox2d(p + vec2(d / 2., -_h / 2. - d * 1.5), vec2(d / 2., _h / 2.)), c); // rectangle left
    c = min(sdRing2d(p + vec2(d * 1.5, -_h - d * 1.5), vec2(cos(pi / 2.), sin(pi / 2.)), d, d), c); // ring top
    c = min(sdBox2d(p + vec2(d * 2.5, -_h / 2. - d * 1.5), vec2(d / 2., _h / 2.)), c); // rectangle right
    return c;
}

float sdq(in vec2 p) {
    float g = sdRing2d(p + vec2(d * 1.5, -432.5), vec2(cos(pi / 2.), sin(pi / 2.)), d, d); // ring top
    g = min(sdRoundedBox2d(p + vec2(d * 2.5, -116.25), vec2(d / 2., 632.5 / 2.), vec4(0., d / 2., 0., d / 2.)), g); // rectangle right
    g = smin2d(sdBox2d(p + vec2(d * 1.75, -d / 2.), vec2(d / 4., d / 2.)), g, d / 8.); // rectangle bot
    g = min(sdRing2d(rotate2d(p + vec2(d * 1.5, d * -1.5), pi * 0.75), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), g); // quarter ring
    g = min(sdBox2d(p + vec2(d / 2., -_h / 2. - d * 1.5), vec2(d / 2., _h / 2.)), g); // rectangle left
    return g;
}

float sdp(in vec2 p) {
    return sdq(p * vec2(-1., 1.));
}

float sdr(in vec2 p) {
    float m = sdRoundedBox2d(p + vec2(d / 2., -432.5 / 2.), vec2(d / 2., 432.5 / 2.), vec4(0, d / 2., 0., d / 2.));
    m = min(sdRing2d(rotate2d(p + vec2(d * 1.5, -432.5), pi / 4.), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), m); // quarter ring
    m = min(sdCircle2d(p + vec2(d * 1.5, -500. + d / 2.), d / 2.), m);
    return m;
}

float sds(in vec2 p) {
    float c = sdRing2d(p + vec2(d * 1.5, -d * 1.5), vec2(cos(pi / -2.), sin(pi / -2.)), d, d); // ring bottom
    c = min(sdBox2d(p + vec2(d / 2., -342.5 - d), vec2(d / 2., d)), c);
    c = min(sdBox2d(p + vec2(d * 2.5, -67.5 - 185. / 2.), vec2(d / 2., 185. / 2.)), c);
    c = min(sdRing2d(p + vec2(d * 1.5, -_h - d * 1.5), vec2(cos(pi / 2.), sin(pi / 2.)), d, d), c); // ring top
    c = min(sdRoundedBox2d(p + vec2(d * 0.5, -67.5 - 162.5 / 2.), vec2(d / 2., 162.5 / 2.), vec4(d / 2., 0., d / 2., 0.)), c); // box bottom
    c = min(sdRoundedBox2d(p + vec2(d * 2.5, -_h - d * 0.75), vec2(d / 2., d * 0.75), vec4(0., d / 2., 0., d / 2.)), c); // box top
    c = min(sdRing2d(rotate2d(p + vec2(d * 1.5, -252.5 - d * 2.), pi * 0.75), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), c);
    c = min(sdRing2d(rotate2d(p + vec2(d * 1.5, -252.5), pi * -0.25), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), c);
    return c;
}

float sdt(in vec2 p) {
    float t = sdRoundedBox2d(p + vec2(0., -350.), vec2(d / 2., 350.), vec4(d / 2.));
    t = smin2d(sdRoundedBox2d(p + vec2(0., -500. - d / 4.), vec2(135. / 2., d / 2.), vec4(d / 2.)), t, d / 8.);
    return t;
}

float sdu(in vec2 p) {
    return sdn(p * -1. + vec2(d * -3., 500.));
}

float sdv(in vec2 p) {
    return sdn(p * -1. + vec2(d * -3., 500.));
}

float sdw(in vec2 p) {
    return sdm(p * vec2(1., -1.) + vec2(0., 500.));
}

float sdx(in vec2 p) {
    float n = sdRoundedBox2d(p + vec2(d / 2., -80.), vec2(d / 2., 80.), vec4(0, d / 2., 0., d / 2.));
    n = min(sdRoundedBox2d(p + vec2(d * 2.5, -80.), vec2(d / 2., 80.), vec4(0, d / 2., 0., d / 2.)), n);
    n = min(sdRing2d(p + vec2(d * 1.5, -80. - d * 1.5), vec2(cos(pi / 2.), sin(pi / 2.)), d, d), n); // ring bottom
    n = min(sdRing2d(p + vec2(d * 1.5, -272.5 - d * 1.5), vec2(cos(pi / -2.), sin(pi / -2.)), d, d), n); // ring top
    n = min(sdRoundedBox2d(p + vec2(d * .5, -80. - 340.), vec2(d / 2., 80.), vec4(d / 2., 0., d / 2., 0.)), n);
    n = min(sdRoundedBox2d(p + vec2(d * 2.5, -80. - 340.), vec2(d / 2., 80.), vec4(d / 2., 0., d / 2., 0.)), n);
    return n;
}

float sdy(in vec2 p) {
    float g = sdRoundedBox2d(p + vec2(d * 2.5, -150.), vec2(d / 2., 350.), vec4(d / 2.)); // rectangle right
    g = smin2d(sdBox2d(p + vec2(d * 1.75, -d / 2.), vec2(d / 4., d / 2.)), g, d / 8.); // rectangle bot
    g = min(sdRing2d(rotate2d(p + vec2(d * 1.5, d * -1.5), pi * 0.75), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), g); // quarter ring
    g = min(sdRoundedBox2d(p + vec2(d / 2., -432.5 / 2. - d * 1.5), vec2(d / 2., 432.5 / 2.), vec4(d / 2., 0., d / 2., 0.)), g); // rectangle left
    return g;
}

float sdz(in vec2 p) {
    float c = sdRoundedBox2d(p + vec2(67.5 / 2., -500. + d / 2.), vec2(67.5 / 2., d / 2.), vec4(d / 2., d / 2., 0., 0.)); // ring bottom
    c = min(sdBox2d(p + vec2(d * 2.5, -342.5 - d), vec2(d / 2., d)), c);
    c = min(sdBox2d(p + vec2(d * 0.5, -67.5 - 185. / 2.), vec2(d / 2., 185. / 2.)), c);
    c = min(sdRing2d(rotate2d(p + vec2(d * 1.5, -252.5 - d * 2.), pi * -0.75), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), c);
    c = min(sdRing2d(rotate2d(p + vec2(d * 1.5, -252.5), pi * 0.25), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), c);
    c = min(sdRoundedBox2d(p + vec2(67.5  * 1.5, -d / 2.), vec2(67.5 / 2., d / 2.), vec4(0., 0., d / 2., d / 2.)), c);
    c = min(sdRing2d(rotate2d(p + vec2(d * 1.5, -500. + d * 1.5), pi * -0.25), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), c);
    c = min(sdRing2d(rotate2d(p + vec2(d * 1.5, -d * 1.5), pi * 0.75), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), c);
    return c;
}

float sd1(in vec2 p) {
    return sdl(p);
}

float sd2(in vec2 p) {
    float c = sdRoundedBox2d(p + vec2(67.5 / 2., -700. + d / 2.), vec2(67.5 / 2., d / 2.), vec4(d / 2., d / 2., 0., 0.));
    c = min(sdRing2d(rotate2d(p + vec2(d * 1.5, -700. + d * 1.5), pi * -0.25), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), c);
    c = min(sdBox2d(p + vec2(d * 2.5, -566.25), vec2(d / 2., 66.25)), c);
    c = min(sdRing2d(rotate2d(p + vec2(d * 1.5, -500.), pi * -0.75), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), c);
    c = min(sdRing2d(rotate2d(p + vec2(d * 1.5, -500. + 67.5 + 45./2.), pi * 0.25), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), c);
    c = min(sdBox2d(p + vec2(d * 0.5, -342.5 / 2. - 67.5), vec2(d / 2., 342.5 / 2.)), c);
    c = min(sdRoundedBox2d(p + vec2(67.5  * 1.5, -d / 2.), vec2(67.5 / 2., d / 2.), vec4(0., 0., d / 2., d / 2.)), c);
    c = min(sdRing2d(rotate2d(p + vec2(d * 1.5, -d * 1.5), pi * 0.75), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), c);
    return c;
}

float sdE(in vec2 p) {
    float c = sdRoundedBox2d(p + vec2(67.5  * 1.5, -700. + d / 2.), vec2(67.5 / 2., d / 2.), vec4(0., 0., d / 2., d / 2.));
    c = min(sdRing2d(rotate2d(p + vec2(d * 1.5, -700. + d * 1.5), pi * 0.25), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), c);
    c = min(sdBox2d(p + vec2(d * 0.5, -565. / 2. - 67.5), vec2(d / 2., 565. / 2.)), c);
    c = smin2d(sdBox2d(p + vec2(d * 1.25, -455.), vec2(d / 4., d / 2.)), c, d / 8.);
    c = min(sdRoundedBox2d(p + vec2(67.5 + d / 2., -500. + d), vec2(d / 2.), vec4(0., 0., d / 2., d / 2.)), c);
    c = min(sdRoundedBox2d(p + vec2(67.5  * 1.5, -d / 2.), vec2(67.5 / 2., d / 2.), vec4(0., 0., d / 2., d / 2.)), c);
    c = min(sdRing2d(rotate2d(p + vec2(d * 1.5, -d * 1.5), pi * 0.75), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), c);
    return c;
}

float sd3(in vec2 p) {
    return sdE((p * vec2(-1., 1.) - vec2(135., 0.)));
}

float sd4(in vec2 p) {
    float g = sdRoundedBox2d(p + vec2(d * 2.5, -350.), vec2(d / 2., 350.), vec4(d / 2.)); // rectangle right
    g = smin2d(sdBox2d(p + vec2(d * 1.75, -500. + d), vec2(d / 4., d / 2.)), g, d / 8.); 
    g = min(sdRing2d(rotate2d(p + vec2(d * 1.5, -500.), pi * 0.75), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), g); // quarter ring
    g = min(sdRoundedBox2d(p + vec2(d / 2., -600.), vec2(d / 2., 100.), vec4(d / 2., 0., d / 2., 0.)), g); // rectangle left
    return g;
}

float sd5(in vec2 p) {
    float c = sdRing2d(p + vec2(d * 1.5, -d * 1.5), vec2(cos(pi / -2.), sin(pi / -2.)), d, d); // ring bottom
    c = min(sdRoundedBox2d(p + vec2(d * 0.5, -67.5 * 1.5), vec2(d / 2., 67.5 / 2.), vec4(d / 2., 0., d / 2., 0.)), c); // box bottom
    c = min(sdBox2d(p + vec2(d * 2.5, -67.5 - 342.5 / 2.), vec2(d / 2., 342.5 / 2.)), c);
    c = min(sdRing2d(rotate2d(p + vec2(d * 1.5, -342.5 - 67.5 - d * 2.), pi * 0.75), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), c);
    c = min(sdRing2d(rotate2d(p + vec2(d * 1.5, -342.5 - 67.5), pi * -0.25), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), c);
    c = min(sdBox2d(p + vec2(d / 2., -566.25), vec2(d / 2., 66.25)), c);
    c = min(sdRing2d(rotate2d(p + vec2(d * 1.5, -700. + d * 1.5), pi * 0.25), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), c);
    c = min(sdRoundedBox2d(p + vec2(67.5  * 1.5, -700. + d / 2.), vec2(67.5 / 2., d / 2.), vec4(0., 0., d / 2., d / 2.)), c);
    return c;
}

float sd6(in vec2 p) {
    float c = sdRing2d(p + vec2(d * 1.5, -d * 1.5), vec2(cos(pi / -2.), sin(pi / -2.)), d, d); // ring bottom
    c = min(sdBox2d(p + vec2(d / 2., -565. / 2. - 67.5), vec2(d / 2., 565. / 2.)), c); // rectangle left
    c = smin2d(sdBox2d(p + vec2(d * 1.25, -455.), vec2(d / 4., d / 2.)), c, d / 8.); // small rectangle middle
    c = min(sdRing2d(p + vec2(d * 1.5, -632.5), vec2(cos(pi / 2.), sin(pi / 2.)), d, d), c); // ring top
    c = min(sdBox2d(p + vec2(d * 2.5, -67.5 - 342.5 / 2.), vec2(d / 2., 342.5 / 2.)), c);
    c = min(sdRing2d(rotate2d(p + vec2(d * 1.5, -342.5 - 67.5), pi * -0.25), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), c);
    c = min(sdRoundedBox2d(p + vec2(d * 2.5, -632.5 + 67.5 / 2.), vec2(d / 2., 67.5 / 2.), vec4(0., d / 2., 0., d / 2.)), c);
    return c;
}

float sd7(in vec2 p) {
    float c = sdRoundedBox2d(p + vec2(67.5 / 2., -700. + d / 2.), vec2(67.5 / 2., d / 2.), vec4(d / 2., d / 2., 0., 0.)); // ring bottom
    c = min(sdRing2d(rotate2d(p + vec2(d * 1.5, -700. + d * 1.5), pi * -0.25), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), c);
    c = min(sdRoundedBox2d(p + vec2(d * 2.5, -632.5 / 2.), vec2(d / 2., 632.5 / 2.), vec4(0., d / 2., 0., d / 2.)), c);
    return c;
}

float sd8(in vec2 p) {
    float c = sdRing2d(p + vec2(d * 1.5, -d * 1.5), vec2(cos(pi / -2.), sin(pi / -2.)), d, d); // ring bottom
    c = min(sdBox2d(p + vec2(d / 2., -565. / 2. - 67.5), vec2(d / 2., 565. / 2.)), c); // rectangle left
    c = smin2d(sdBox2d(p + vec2(d * 1.25, -455.), vec2(d / 4., d / 2.)), c, d / 8.); // small rectange left
    c = min(sdRing2d(p + vec2(d * 1.5, -700. + 67.5), vec2(cos(pi / 2.), sin(pi / 2.)), d, d), c); // ring top
    float c2 = sdBox2d(p + vec2(d * 2.5, -565. / 2. - 67.5), vec2(d / 2., 565. / 2.)); // rectangle right
    c2 = smin2d(sdBox2d(p + vec2(d * 1.75, -455.), vec2(d / 4., d / 2.)), c2, d / 8.); // small rectange left
    c = min(c, c2); 
    return c;
}

float sd9(in vec2 p) {
    float g = sdRing2d(p + vec2(d * 1.5, -632.5), vec2(cos(pi / 2.), sin(pi / 2.)), d, d); // ring top
    g = min(sdBox2d(p + vec2(d * 2.5, -565. / 2. - 67.5), vec2(d / 2., 565. / 2.)), g); // rectangle left
    g = smin2d(sdBox2d(p + vec2(d * 1.75, -455.), vec2(d / 4., d / 2.)), g, d / 8.); // rectangle bot
    g = min(sdRing2d(rotate2d(p + vec2(d * 1.5, -500.), pi * 0.75), vec2(cos(pi / 4.), sin(pi / 4.)), d, d), g); // quarter ring
    g = min(sdBox2d(p + vec2(d / 2., -500. - 132.5 / 2.), vec2(d / 2., 132.5 / 2.)), g); // rectangle left
    g = min(sdRing2d(p + vec2(d * 1.5, -d * 1.5), vec2(cos(pi / -2.), sin(pi / -2.)), d, d), g); // ring bottom
    g = min(sdRoundedBox2d(p + vec2(d * 0.5, -67.5 * 1.5), vec2(d / 2., 67.5 / 2.), vec4(d / 2., 0., d / 2., 0.)), g); // box bottom
    return g;
}

float sd0(in vec2 p) {
    float c = sdRing2d(p + vec2(d * 1.5, -d * 1.5), vec2(cos(pi / -2.), sin(pi / -2.)), d, d); // ring bottom
    c = min(sdBox2d(p + vec2(d / 2., -565. / 2. - 67.5), vec2(d / 2., 565. / 2.)), c); // rectangle left
    c = min(sdRing2d(p + vec2(d * 1.5, -700. + 67.5), vec2(cos(pi / 2.), sin(pi / 2.)), d, d), c); // ring top
    c = min(sdBox2d(p + vec2(d * 2.5, -565. / 2. - 67.5), vec2(d / 2., 565. / 2.)), c); // rectangle right
    return c;
}

float sdNotDefined(in vec2 p) {
    return sdRoundedBox2d(p + vec2(d * 1.5, -350.), vec2(d * 1.5, 350.), vec4(d / 2.));
}

// ╔══════════════════════════════════════════════════════════╗
// ║                 SDF COMBINING OPERATIONS                 ║
// ╚══════════════════════════════════════════════════════════╝
vec2 smin(float a, float b, float k) { // ret.a = distance, ret.b = blendfactor //return vec2(min(a, b), a);
    k *= 6.0f;
    float h = max(k - abs(a - b), 0.0f) / k;
    float m = h * h * h * 0.5f;
    float s = m * k * (1.0f / 3.0f);
    return (a < b) ? vec2(a - s, m) : vec2(b - s, 1.0f - m);
}

float opUnion(float a, float b) {
    return min(a, b);
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
    min(a.distance, b.distance));//
}

float opSubtraction(float a, float b) {
    return max(a, -b);
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

float opIntersection(float a, float b) {
    return max(a, b);
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

float opXor(float a, float b) {
    return max(min(a, b), - max(a, b));
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

float opSmoothUnion(float a, float b, float smoothness) {
    return smin(a, b, smoothness).x;
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

float opSmoothSubtraction(float a, float b, float smoothness) {
    return smin(-a, b, smoothness).x;
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

float opSmoothIntersection(float a, float b, float smoothness) {
    return smin(-a, -b, smoothness).x;
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
vec3 unpackColor(float f) {
    uint u = floatBitsToUint(f);
    return vec3(//
    float((u >> 24u) & 255u), //
    float((u >> 16u) & 255u), //
    float((u >> 8u) & 255u) //
    ) / 255.0f;
}

void initializeData(inout float data) {
    data = MAX_FLOAT;
}

void initializeData(inout Surface data) {
    data.colorDiffuse = vec3(0.f);
    data.colorSpecular = vec3(0.f);
    data.colorAmbient = vec3(0.f);
    data.kd = 0.f; // diffuse material property
    data.ks = 0.f; // specular material property
    data.p = 0.f; // specular exponent, fall of of specular light
    data.ka = 0.1f; // ambient material property
    data.distance = MAX_FLOAT;
}

void populateData(inout float data, int elementIdx) {
}

void populateData(inout Surface data, int elementIdx) {
    data.colorDiffuse = unpackColor(shadingData[elementIdx].x);
    data.colorSpecular = unpackColor(shadingData[elementIdx].y);
    data.colorAmbient = unpackColor(shadingData[elementIdx].z);
    data.kd = shadingData[elementIdx].w; // diffuse material property 
    data.ks = shadingData[elementIdx + 1].x; // specular material property 
    data.p  = shadingData[elementIdx + 1].y; // specular exponent, fall of of specular light
    data.ka = shadingData[elementIdx + 1].z; // ambient material property
}

void setDistance(inout float destination, float distance) {
    destination = distance;
}

void setDistance(inout Surface destination, float distance) {
    destination.distance = distance;
}

#define GENERATE_MAP_FUNCTION(FUNCTION_NAME, RETURN_TYPE)                                                                                       \
RETURN_TYPE FUNCTION_NAME(vec3 p) {                                                                                                             \
    RETURN_TYPE result;                                                                                                                         \
    initializeData(result);                                                                                                                     \
                                                                                                                                                \
    int elementIdx = 0;                                                                                                                         \
                                                                                                                                                \
    for (int layer = ZERO; layer < uNumLayers; layer++) {                                                                                       \
        int layerOperation = uLayerOperations[layer];                                                                                           \
        int numElements = uElementsInLayer[layer];                                                                                              \
        float smoothness = uSmoothingFactors[layer];                                                                                            \
                                                                                                                                                \
        for (int i = ZERO; i < numElements; i++) {                                                                                              \
            RETURN_TYPE current;                                                                                                                \
            populateData(current, elementIdx);                                                                                                  \
                                                                                                                                                \
            float sdValue;                                                                                                                      \
                                                                                                                                                \
            mat4 M = mat4(                                                                                                                      \
                vec4(geometryData[elementIdx].xyz, 0.f),                                                                                        \
                vec4(geometryData[elementIdx].w, geometryData[elementIdx + 1].x, geometryData[elementIdx + 1].y, 0.f),                          \
                vec4(geometryData[elementIdx + 1].z, geometryData[elementIdx + 1].w, geometryData[elementIdx + 2].x, 0.f),                      \
                vec4(geometryData[elementIdx + 2].yzw, 1.f)                                                                                     \
            );                                                                                                                                  \
                                                                                                                                                \
            vec3 pos = (M * vec4(p, 1.f)).xyz;                                                                                                  \
                                                                                                                                                \
            switch (floatBitsToInt(geometryData[elementIdx + 3].x)) {                                                                           \
                case 0: /* Sphere */                                                                                                            \
                    sdValue = sdSphere(pos, geometryData[elementIdx + 3].y);                                                                    \
                    elementIdx += 4;                                                                                                            \
                    break;                                                                                                                      \
                case 1: /* Simple Box */                                                                                                        \
                    sdValue = sdBox(pos, vec3(geometryData[elementIdx + 3].yzw));                                                               \
                    elementIdx += 4;                                                                                                            \
                    break;                                                                                                                      \
                case 2: /* Box (with optional rounded corners) */                                                                               \
                    float w = geometryData[elementIdx + 3].y;                                                                                   \
                    float h = geometryData[elementIdx + 3].z;                                                                                   \
                    float d = geometryData[elementIdx + 3].w;                                                                                   \
                                                                                                                                                \
                    int initialRotation = floatBitsToInt(geometryData[elementIdx + 5].y);                                                       \
                                                                                                                                                \
                    /* Adiddional Rotation (rounded edge selection) */                                                                          \
                    if (initialRotation == 1) {                                                                                                 \
                        mat3 Rot = mat3(0.f, 0.f, 1.f, 0.f, 1.f, 0.f, -1.f, 0.f, 0.f);                                                          \
                        pos = Rot * pos;                                                                                                        \
                        float temp = w;                                                                                                         \
                        w = d;                                                                                                                  \
                        d = temp;                                                                                                               \
                    } else if (initialRotation == 2) {                                                                                          \
                        mat3 Rot = mat3(1.f, 0.f, 0.f, 0.f, 0.f, -1.f, 0.f, 1.f, 0.f);                                                          \
                        pos = Rot * pos;                                                                                                        \
                        float temp = h;                                                                                                         \
                        h = d;                                                                                                                  \
                        d = temp;                                                                                                               \
                    }                                                                                                                           \
                                                                                                                                                \
                    float val = sdRoundBox2d(pos.xy, vec2(w, h), geometryData[elementIdx + 4], floatBitsToInt(geometryData[elementIdx + 5].x)); \
                    sdValue = opExtrusion(pos, val, d);                                                                                         \
                                                                                                                                                \
                    sdValue = opRound(sdValue, geometryData[elementIdx + 5].z);                                                                 \
                                                                                                                                                \
                    elementIdx += 6;                                                                                                            \
                    break;                                                                                                                      \
                case 3: /* Round Box */                                                                                                         \
                    sdValue = sdRoundBox(pos, geometryData[elementIdx + 3].yzw, geometryData[elementIdx + 4].x);                                \
                    elementIdx += 5;                                                                                                            \
                    break;                                                                                                                      \
                case 4: /* Text */                                                                                                              \
                    /* The letters have the following sizes:                     */                                                             \
                    /*                   │     ┬                                 */                                                             \
                    /* ┌──┐  ┬           ├──┐  │            ┌──┐  ┬              */                                                             \
                    /* │  │  │ 500 units │  │  │ 700 units  │  │  │              */                                                             \
                    /* │  │  │           │  │  │            │  │  │ 700 units    */                                                             \
                    /* └──┘  ┴           └──┘  ┴            └──┤  │              */                                                             \
                    /* ├──┤                                    │  ┴              */                                                             \
                    /* 135 units                                                 */                                                             \
                    /*                                                           */                                                             \
                    /* The stroke width is 45 units for all strokes              */                                                             \
                    int numLetters = floatBitsToInt(geometryData[elementIdx + 3].y);                                                            \
                    float scale = geometryData[elementIdx + 3].z;                                                                               \
                    float depth = geometryData[elementIdx + 3].w;                                                                               \
                    float smoothness = geometryData[elementIdx + 4].x;                                                                          \
                                                                                                                                                \
                    sdValue = MAX_FLOAT;                                                                                                        \
                    for (int letterIdx = 0; letterIdx < numLetters; letterIdx++) {                                                              \
                        M[3][0] = geometryData[elementIdx + 5 + letterIdx].x; /* matrix[column][row] */                                         \
                        M[3][1] = geometryData[elementIdx + 5 + letterIdx].y;                                                                   \
                        M[3][2] = geometryData[elementIdx + 5 + letterIdx].z;                                                                   \
                        int letterCode = floatBitsToInt(geometryData[elementIdx + 5 + letterIdx].w);                                            \
                                                                                                                                                \
                        pos = (M * vec4(p, 1.f)).xyz;                                                                                           \
                        vec2 p_sdf = vec2(0.0, 700.0) - (pos.xy) * scale; /* from bottom-left to orign of "letter space" */                     \
                        float dist2D = MAX_FLOAT;                                                                                               \
                        switch (letterCode) {                                                                                                   \
                            case 48:                                                                                                            \
                                dist2D = sd0(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 49:                                                                                                            \
                                dist2D = sd1(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 50:                                                                                                            \
                                dist2D = sd2(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 51:                                                                                                            \
                                dist2D = sd3(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 52:                                                                                                            \
                                dist2D = sd4(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 53:                                                                                                            \
                                dist2D = sd5(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 54:                                                                                                            \
                                dist2D = sd6(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 55:                                                                                                            \
                                dist2D = sd7(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 56:                                                                                                            \
                                dist2D = sd8(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 57:                                                                                                            \
                                dist2D = sd9(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 97:                                                                                                            \
                                dist2D = sda(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 98:                                                                                                            \
                                dist2D = sdb(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 99:                                                                                                            \
                                dist2D = sdc(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 100:                                                                                                           \
                                dist2D = sdd(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 101:                                                                                                           \
                                dist2D = sde(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 102:                                                                                                           \
                                dist2D = sdf(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 103:                                                                                                           \
                                dist2D = sdg(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 104:                                                                                                           \
                                dist2D = sdh(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 105:                                                                                                           \
                                dist2D = sdi(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 106:                                                                                                           \
                                dist2D = sdj(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 107:                                                                                                           \
                                dist2D = sdk(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 108:                                                                                                           \
                                dist2D = sdl(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 109:                                                                                                           \
                                dist2D = sdm(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 110:                                                                                                           \
                                dist2D = sdn(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 111:                                                                                                           \
                                dist2D = sdo(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 112:                                                                                                           \
                                dist2D = sdp(p_sdf + vec2(135.f, 0.f)) / scale;                                                                 \
                                break;                                                                                                          \
                            case 113:                                                                                                           \
                                dist2D = sdq(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 114:                                                                                                           \
                                dist2D = sdr(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 115:                                                                                                           \
                                dist2D = sds(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 116:                                                                                                           \
                                dist2D = sdt(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 117:                                                                                                           \
                                dist2D = sdu(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 118:                                                                                                           \
                                dist2D = sdv(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 119:                                                                                                           \
                                dist2D = sdw(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 120:                                                                                                           \
                                dist2D = sdx(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 121:                                                                                                           \
                                dist2D = sdy(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            case 122:                                                                                                           \
                                dist2D = sdz(p_sdf) / scale;                                                                                    \
                                break;                                                                                                          \
                            default:                                                                                                            \
                                dist2D = sdNotDefined(p_sdf) / scale;                                                                           \
                                break;                                                                                                          \
                        }                                                                                                                       \
                        sdValue = opSmoothUnion(opExtrusion(pos, dist2D, depth), sdValue, smoothness);                                          \
                    }                                                                                                                           \
                    elementIdx += 5 + numLetters;                                                                                               \
            }                                                                                                                                   \
                                                                                                                                                \
            setDistance(current, sdValue);                                                                                                      \
                                                                                                                                                \
            switch (layerOperation) {                                                                                                           \
                case 0: /* Union */                                                                                                             \
                    result = opUnion(result, current);                                                                                          \
                    break;                                                                                                                      \
                case 1: /* Subtraction */                                                                                                       \
                    result = opSubtraction(result, current);                                                                                    \
                    break;                                                                                                                      \
                case 2: /* Intersection */                                                                                                      \
                    result = opIntersection(result, current);                                                                                   \
                    break;                                                                                                                      \
                case 3: /* Xor */                                                                                                               \
                    result = opXor(result, current);                                                                                            \
                    break;                                                                                                                      \
                case 4: /* Smooth union */                                                                                                      \
                    result = opSmoothUnion(result, current, smoothness);                                                                        \
                    break;                                                                                                                      \
                case 5: /* Smooth subtraction */                                                                                                \
                    result = opSmoothSubtraction(result, current, smoothness);                                                                  \
                    break;                                                                                                                      \
                case 6: /* Smooth intersection */                                                                                               \
                    result = opSmoothIntersection(result, current, smoothness);                                                                 \
                    break;                                                                                                                      \
            }                                                                                                                                   \
        }                                                                                                                                       \
    }                                                                                                                                           \
                                                                                                                                                \
    return result;                                                                                                                              \
}                                                                                                                                               \

GENERATE_MAP_FUNCTION(map, float)
GENERATE_MAP_FUNCTION(mapWithMaterial, Surface)

Surface mapSimple(vec3 p) {
    Surface combinedSurface;
    combinedSurface.colorDiffuse = vec3(1.f);
    combinedSurface.colorSpecular = vec3(0.f);
    combinedSurface.colorAmbient = vec3(0.f);
    combinedSurface.kd = 1.f; // diffuse material property
    combinedSurface.ks = 1.f; // specular material property
    combinedSurface.p = 1.f; // specular exponent, fall of of specular light
    combinedSurface.ka = 1.1f; // ambient material property
    combinedSurface.distance = MAX_FLOAT;

    float rawDist1 = sdBox(p - vec3(0.5f, 0.2f, 0.0f), vec3(0.3f, 0.1f, 0.2f));
    float rawDist2 = sdSphere(p - vec3(0.5f), 0.15f);
    float rawDist3 = sdBox(p - vec3(0.5f, 0.25f, -0.2f), vec3(0.4f, 0.2f, 0.1f));
    combinedSurface.distance = rawDist1;

    Surface s2;
    s2.distance = rawDist2;
    Surface s = opSmoothUnion(combinedSurface, s2, 0.1f);

    s2.distance = rawDist3;
    return opSmoothUnion(s, s2, 0.01f);
}

vec3 calcNormalTetrahedron(vec3 p) {
    // https://iquilezles.org/articles/normalsSDF/
    const float h = 0.0001f;      // replace by an appropriate value
    vec3 n = vec3(0.0f);
    for (int i = ZERO; i < 4; i++) {
        vec3 e = 0.5773f * (2.0f * vec3((((i + 3) >> 1) & 1), ((i >> 1) & 1), (i & 1)) - 1.0f);
        n += e * map(p + e * h);
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
                float sdfMid = map(ro + mid * rd);
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
            return HitInfo(i, p, calcNormalTetrahedron(p), mapWithMaterial(p));
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

        float rNext = map(ro + (t + dNext) * rd);

        // Overrelaxation was too big (only in the case where we don't do raymarching)
        if (!isParallel && dNext > rCurr + rNext) {
            dNext = rCurr;
            rNext = map(ro + (t + dNext) * rd);
        }

        t += dNext;
        dPrev = dNext;
        rLast = rCurr;
        rCurr = rNext;
    }

    return HitInfo(-1, vec3(0.0f), vec3(0.0f), Surface(vec3(0.0f), vec3(0.0f), vec3(0.0f), 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f));
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

float calcSoftshadow(in vec3 ro, in vec3 rd, float tmin, float tmax, const float k) {
    float res = 1.0f;
    float t = tmin;
    for (int i = 0; i < 50; i++) {
        float h = map(ro + rd * t);
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

    if (hit.id == -1) {
        return vec3(0);
    }

    const vec3 lightPos = vec3(0.5f, 0.5f, 10.f);

    vec3 vecToLight = normalize(lightPos - hit.pos);
    vec3 vecFromLight = normalize(hit.pos - lightPos);

    Surface surface = hit.surface;

    float mixFacotr = gaussian(surface.mix, 0.5f, 0.07f);

    float ld = 1.f; // diffuse light intensity (light source dependent)
    float la = 1.f; // ambient light intensity (constant for scene)
    float ls = 1.f; // specular light intensity (light source dependent)

    float iDiffuse = surface.kd * ld * max(0.f, dot(vecToLight, hit.normal));
    float iAmbient = surface.ka * la;
    float iSpecular = surface.ks * ls * pow(max(0.f, dot(reflect(vecFromLight, hit.normal), vec3(0.f, 0.f, 1.f))), surface.p);

    //float shadow = shadow(hit.pos, -sundir, 0.001f, 5.f);
    float shadow; // = softshadow(hit.pos, vecToLight, 0.001f, 5.f, 0.1f);
    //float shadow = calcSoftshadow(hit.pos, -sundir, 0.01f, 5.0f, 16.0f);
    // shadow = max(shadow, 0.1f);
    shadow = 1.0f;

    //return vec3(shadow);
    //return hit.id != -1 ? vec3(1.f) : vec3(0.f);
    return shadow * (iDiffuse * surface.colorDiffuse + iSpecular * surface.colorSpecular) + iAmbient * surface.colorAmbient;
}

struct ColorStop {
    vec3 color;
    float position;
};

#define COLOR_RAMP(colors, factor, finalColor) { \
    int index = 0; \
    for(int i = 0; i < colors.length() - 1; i++){ \
       ColorStop currentColor = colors[i]; \
       bool isInBetween = currentColor.position <= factor; \
       index = isInBetween ? i : index; \
    } \
    ColorStop currentColor = colors[index]; \
    ColorStop nextColor = colors[index + 1]; \
    float range = nextColor.position - currentColor.position; \
    float lerpFactor = (factor - currentColor.position) / range; \
    finalColor = mix(currentColor.color, nextColor.color, lerpFactor); \
} \

// ╔══════════════════════════════════════════════════════════╗
// ║                           MAIN                           ║
// ╚══════════════════════════════════════════════════════════╝
void main(void) {
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

        if (!uTwoDMode) {
            color += shade(trace(posOffset, dir));
        } else {
            posOffset.z = 0.0f;
            Surface surface = mapWithMaterial(posOffset);
            float sdfValue = surface.distance * 80.;

            ColorStop[] colors = ColorStop[](
			    //ColorStop(surface.colorDiffuse, 0.000000),
			    ColorStop(vec3(0.000000, 0.000000, 0.015996), 0.000000),
			    ColorStop(vec3(0.008023, 0.002428, 0.162029), 0.300000),
			    ColorStop(vec3(0.590619, 0.964686, 0.428690), 0.400000),
			    ColorStop(vec3(0.991102, 0.031896, 0.814847), 0.600000),
			    ColorStop(vec3(1.000000, 0.000000, 0.001821), 0.800000),
			    ColorStop(vec3(0.008023, 0.002428, 0.162029), 0.900000),
			    ColorStop(vec3(0.000000, 0.000000, 0.015996), 1.000000));
            vec3 finalColor;
            COLOR_RAMP(colors, sdfValue, finalColor);

            color += vec3(finalColor);
        }
    }

    color /= float(subPixleOffsets.length());

    fragColor = vec4(color, 1.f);
}