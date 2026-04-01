#version 300 es
precision highp float;

in vec2 vUv;
out float fragColor; // Rendering to a single RED channel

uniform int uCharIndex; 
uniform vec2 uBoxMin; 
uniform vec2 uBoxMax;

// ╔══════════════════════════════════════════════════════════╗
// ║                     SDF of letters                       ║
// ╚══════════════════════════════════════════════════════════╝
// Pre-calculated trigonometric constants & vectors
const float SQRT_05 = 0.7071067811865476;
const vec2 n_pi_2   = vec2(0.0, 1.0);
const vec2 n_mpi_2  = vec2(0.0, -1.0);
const vec2 n_pi_4   = vec2(SQRT_05, SQRT_05);
const vec2 n_mpi_4  = vec2(SQRT_05, -SQRT_05);
const vec2 n_3pi_4  = vec2(-SQRT_05, SQRT_05);
const vec2 n_m3pi_4 = vec2(-SQRT_05, -SQRT_05);

#define M_PI 3.1415926535897932384626433832795

vec2 rotate2d(vec2 v, float a) {
    float s = sin(a);
    float c = cos(a);
    mat2 m = mat2(c, s, -s, c);
    return m * v;
}

// Pre-calculated rotation matrices
const mat2 rot_pi_4   = mat2(SQRT_05, SQRT_05, -SQRT_05, SQRT_05);
const mat2 rot_mpi_4  = mat2(SQRT_05, -SQRT_05, SQRT_05, SQRT_05);
const mat2 rot_3pi_4  = mat2(-SQRT_05, SQRT_05, -SQRT_05, -SQRT_05);
const mat2 rot_m3pi_4 = mat2(-SQRT_05, -SQRT_05, SQRT_05, -SQRT_05);

// Pre-calculated corner radius vectors
const vec4 r0_225_0_225 = vec4(0.0, 22.5, 0.0, 22.5);
const vec4 r225_0_225_0 = vec4(22.5, 0.0, 22.5, 0.0);
const vec4 r225_225_0_0 = vec4(22.5, 22.5, 0.0, 0.0);
const vec4 r0_0_225_225 = vec4(0.0, 0.0, 22.5, 22.5);
const vec4 r225         = vec4(22.5);

// Simplifications of base SDF functions
float smin2d(float a, float b) {
    const float k = 19.20495128834866; // 5.625 * (1.0 / (1.0 - sqrt(0.5)))
    float h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - 9.60247564417433 * (1.0 + h - sqrt(1.0 - h * (h - 2.0))); // 9.6024... = k * 0.5
}

float sdCircle2d(vec2 p) {
    return length(p) - 22.5; // All circles use radius 22.5 (d/2)
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

float sdRing2d(in vec2 p, in vec2 n) {
    p.x = abs(p.x);
    p = mat2(n.x, n.y, -n.y, n.x) * p;
    // All rings used r=45.0, th=45.0 (d, d)
    return max(abs(length(p) - 45.0) - 22.5, length(vec2(p.x, max(0.0, abs(45.0 - p.y) - 22.5))) * sign(p.x));
}

// Letter SDFs
float sda(in vec2 p) {
    float a = sdRing2d(p + vec2(67.5, -432.5), n_pi_2);
    a = min(sdRoundedBox2d(p + vec2(22.5, -375.0), vec2(22.5, 57.5), r0_225_0_225), a);
    a = min(sdBox2d(p + vec2(112.5, -250.0), vec2(22.5, 182.5)), a);
    a = min(sdRing2d(p + vec2(67.5, -67.5), n_mpi_2), a);
    a = smin2d(sdBox2d(p + vec2(78.75, -250.0), vec2(11.25, 22.5)), a);
    a = min(sdBox2d(p + vec2(22.5, -136.25), vec2(22.5, 68.75)), a);
    a = min(sdRing2d(rot_pi_4 * (p + vec2(67.5, -205.0)), n_pi_4), a);
    return a;
}

float sdb(in vec2 p) {
    float b = sdRing2d(p + vec2(67.5, -67.5), n_mpi_2);
    b = min(sdRoundedBox2d(p + vec2(22.5, -383.75), vec2(22.5, 316.25), r225_0_225_0), b);
    b = smin2d(sdBox2d(p + vec2(56.25, -477.5), vec2(11.25, 22.5)), b);
    b = min(sdBox2d(p + vec2(112.5, -250.0), vec2(22.5, 182.5)), b);
    b = min(sdRing2d(rot_mpi_4 * (p + vec2(67.5, -432.5)), n_pi_4), b);
    return b;
}

float sdc(in vec2 p) {
    float c = sdRing2d(p + vec2(67.5, -67.5), n_mpi_2);
    c = min(sdBox2d(p + vec2(22.5, -250.0), vec2(22.5, 182.5)), c);
    c = min(sdRing2d(p + vec2(67.5, -432.5), n_pi_2), c);
    c = min(sdRoundedBox2d(p + vec2(112.5, -101.25), vec2(22.5, 33.75), r225_0_225_0), c);
    c = min(sdRoundedBox2d(p + vec2(112.5, -398.75), vec2(22.5, 33.75), r0_225_0_225), c);
    return c;
}

float sdd(in vec2 p) {
    return sdb(vec2(-p.x - 135.0, p.y));
}

float sde(in vec2 p) {
    return sda(vec2(-p.x - 135.0, -p.y + 500.0));
}

float sdf(in vec2 p) {
    float f = sdRoundedBox2d(p + vec2(22.5, -316.25), vec2(22.5, 316.25), r0_225_0_225);
    f = min(sdRing2d(p + vec2(67.5, -632.5), n_pi_2), f);
    f = min(sdRoundedBox2d(p + vec2(112.5, -610.0), vec2(22.5, 22.5), r0_225_0_225), f);
    f = smin2d(sdRoundedBox2d(p + vec2(22.5, -522.5), vec2(67.5, 22.5), r225), f);
    return f;
}

float sdg(in vec2 p) {
    float g = sdRing2d(p + vec2(67.5, -432.5), n_pi_2);
    g = min(sdBox2d(p + vec2(112.5, -150.0), vec2(22.5, 282.5)), g);
    g = smin2d(sdBox2d(p + vec2(78.75, -22.5), vec2(11.25, 22.5)), g);
    g = min(sdRing2d(rot_3pi_4 * (p + vec2(67.5, -67.5)), n_pi_4), g);
    g = min(sdBox2d(p + vec2(22.5, -250.0), vec2(22.5, 182.5)), g);
    g = min(sdRing2d(p + vec2(67.5, 132.5), n_mpi_2), g);
    g = min(sdRoundedBox2d(p + vec2(22.5, 110.0), vec2(22.5, 33.75), r225_0_225_0), g);
    return g;
}

float sdh(in vec2 p) {
    float h = sdRoundedBox2d(p + vec2(22.5, -350.0), vec2(22.5, 350.0), r225);
    h = smin2d(sdBox2d(p + vec2(56.25, -477.5), vec2(11.25, 22.5)), h);
    h = min(sdRoundedBox2d(p + vec2(112.5, -216.25), vec2(22.5, 216.25), r0_225_0_225), h);
    h = min(sdRing2d(rot_mpi_4 * (p + vec2(67.5, -432.5)), n_pi_4), h);
    return h;
}

float sdi(in vec2 p) {
    float i = sdRoundedBox2d(p + vec2(22.5, -250.0), vec2(22.5, 250.0), r225);
    i = min(sdCircle2d(p + vec2(22.5, -567.5)), i);
    return i;
}

float sdj(in vec2 p) {
    float j = sdRoundedBox2d(p + vec2(22.5, -183.75), vec2(22.5, 316.25), r225_0_225_0);
    j = min(sdRing2d(p + vec2(-22.5, 132.5), n_mpi_2), j);
    j = min(sdRoundedBox2d(p + vec2(-67.5, 98.75), vec2(22.5, 33.75), r225_0_225_0), j);
    j = min(sdCircle2d(p + vec2(22.5, -567.5)), j);
    return j;
}

float sdk(in vec2 p) {
    float k = sdRoundedBox2d(p + vec2(22.5, -350.0), vec2(22.5, 350.0), r225);
    k = smin2d(sdBox2d(p + vec2(56.25, -340.0), vec2(11.25, 22.5)), k);
    k = smin2d(sdBox2d(p + vec2(56.25, -250.0), vec2(11.25, 22.5)), k);
    k = min(sdRoundedBox2d(p + vec2(112.5, -102.5), vec2(22.5, 102.5), r0_225_0_225), k);
    k = min(sdRing2d(rot_mpi_4 * (p + vec2(67.5, -205.0)), n_pi_4), k);
    k = min(sdRing2d(rot_m3pi_4 * (p + vec2(67.5, -385.0)), n_pi_4), k);
    k = min(sdRoundedBox2d(p + vec2(112.5, -442.5), vec2(22.5, 57.5), r225_0_225_0), k);
    return k;
}

float sdl(in vec2 p) {
    return sdRoundedBox2d(p + vec2(22.5, -350.0), vec2(22.5, 350.0), r225);
}

float sdm(in vec2 p) {
    float m = sdRoundedBox2d(p + vec2(22.5, -216.25), vec2(22.5, 216.25), r0_225_0_225);
    m = min(sdBox2d(p + vec2(112.5, -477.5), vec2(45.0, 22.5)), m);
    m = smin2d(sdRoundedBox2d(p + vec2(112.5, -227.5), vec2(22.5, 227.5), r0_225_0_225), m);
    m = min(sdRing2d(rot_pi_4 * (p + vec2(67.5, -432.5)), n_pi_4), m);
    m = min(sdRing2d(rot_mpi_4 * (p + vec2(157.5, -432.5)), n_pi_4), m);
    m = min(sdRoundedBox2d(p + vec2(202.5, -216.25), vec2(22.5, 216.25), r0_225_0_225), m);
    return m;
}

float sdn(in vec2 p) {
    float n = sdRoundedBox2d(p + vec2(22.5, -216.25), vec2(22.5, 216.25), r0_225_0_225);
    n = min(sdRoundedBox2d(p + vec2(112.5, -216.25), vec2(22.5, 216.25), r0_225_0_225), n);
    n = min(sdRing2d(p + vec2(67.5, -432.5), n_pi_2), n); 
    return n;
}

float sdo(in vec2 p) {
    float c = sdRing2d(p + vec2(67.5, -67.5), n_mpi_2);
    c = min(sdBox2d(p + vec2(22.5, -250.0), vec2(22.5, 182.5)), c);
    c = min(sdRing2d(p + vec2(67.5, -432.5), n_pi_2), c);
    c = min(sdBox2d(p + vec2(112.5, -250.0), vec2(22.5, 182.5)), c);
    return c;
}

float sdq(in vec2 p) {
    float g = sdRing2d(p + vec2(67.5, -432.5), n_pi_2);
    g = min(sdRoundedBox2d(p + vec2(112.5, -116.25), vec2(22.5, 316.25), r0_225_0_225), g);
    g = smin2d(sdBox2d(p + vec2(78.75, -22.5), vec2(11.25, 22.5)), g);
    g = min(sdRing2d(rot_3pi_4 * (p + vec2(67.5, -67.5)), n_pi_4), g);
    g = min(sdBox2d(p + vec2(22.5, -250.0), vec2(22.5, 182.5)), g);
    return g;
}

float sdp(in vec2 p) {
    return sdq(vec2(-p.x, p.y));
}

float sdr(in vec2 p) {
    float m = sdRoundedBox2d(p + vec2(22.5, -216.25), vec2(22.5, 216.25), r0_225_0_225);
    m = min(sdRing2d(rot_pi_4 * (p + vec2(67.5, -432.5)), n_pi_4), m); 
    m = min(sdCircle2d(p + vec2(67.5, -477.5)), m);
    return m;
}

float sds(in vec2 p) {
    float c = sdRing2d(p + vec2(67.5, -67.5), n_mpi_2);
    c = min(sdBox2d(p + vec2(22.5, -387.5), vec2(22.5, 45.0)), c);
    c = min(sdBox2d(p + vec2(112.5, -160.0), vec2(22.5, 92.5)), c);
    c = min(sdRing2d(p + vec2(67.5, -432.5), n_pi_2), c); 
    c = min(sdRoundedBox2d(p + vec2(22.5, -148.75), vec2(22.5, 81.25), r225_0_225_0), c); 
    c = min(sdRoundedBox2d(p + vec2(112.5, -398.75), vec2(22.5, 33.75), r0_225_0_225), c); 
    c = min(sdRing2d(rot_3pi_4 * (p + vec2(67.5, -342.5)), n_pi_4), c);
    c = min(sdRing2d(rot_mpi_4 * (p + vec2(67.5, -252.5)), n_pi_4), c);
    return c;
}

float sdt(in vec2 p) {
    float t = sdRoundedBox2d(p + vec2(0.0, -350.0), vec2(22.5, 350.0), r225);
    t = smin2d(sdRoundedBox2d(p + vec2(0.0, -522.5), vec2(67.5, 22.5), r225), t);
    return t;
}

float sdu(in vec2 p) {
    return sdn(vec2(-p.x - 135.0, -p.y + 500.0));
}

float sdv(in vec2 p) {
    return sdu(p);
}

float sdw(in vec2 p) {
    return sdm(vec2(p.x, -p.y + 500.0));
}

float sdx(in vec2 p) {
    float n = sdRoundedBox2d(p + vec2(22.5, -80.0), vec2(22.5, 80.0), r0_225_0_225);
    n = min(sdRoundedBox2d(p + vec2(112.5, -80.0), vec2(22.5, 80.0), r0_225_0_225), n);
    n = min(sdRing2d(p + vec2(67.5, -147.5), n_pi_2), n); 
    n = min(sdRing2d(p + vec2(67.5, -340.0), n_mpi_2), n); 
    n = min(sdRoundedBox2d(p + vec2(22.5, -420.0), vec2(22.5, 80.0), r225_0_225_0), n);
    n = min(sdRoundedBox2d(p + vec2(112.5, -420.0), vec2(22.5, 80.0), r225_0_225_0), n);
    return n;
}

float sdy(in vec2 p) {
    float g = sdRoundedBox2d(p + vec2(112.5, -150.0), vec2(22.5, 350.0), r225);
    g = smin2d(sdBox2d(p + vec2(78.75, -22.5), vec2(11.25, 22.5)), g);
    g = min(sdRing2d(rot_3pi_4 * (p + vec2(67.5, -67.5)), n_pi_4), g);
    g = min(sdRoundedBox2d(p + vec2(22.5, -283.75), vec2(22.5, 216.25), r225_0_225_0), g);
    return g;
}

float sdz(in vec2 p) {
    float c = sdRoundedBox2d(p + vec2(33.75, -477.5), vec2(33.75, 22.5), r225_225_0_0);
    c = min(sdBox2d(p + vec2(112.5, -387.5), vec2(22.5, 45.0)), c);
    c = min(sdBox2d(p + vec2(22.5, -160.0), vec2(22.5, 92.5)), c);
    c = min(sdRing2d(rot_m3pi_4 * (p + vec2(67.5, -342.5)), n_pi_4), c);
    c = min(sdRing2d(rot_pi_4 * (p + vec2(67.5, -252.5)), n_pi_4), c);
    c = min(sdRoundedBox2d(p + vec2(101.25, -22.5), vec2(33.75, 22.5), r0_0_225_225), c);
    c = min(sdRing2d(rot_mpi_4 * (p + vec2(67.5, -432.5)), n_pi_4), c);
    c = min(sdRing2d(rot_3pi_4 * (p + vec2(67.5, -67.5)), n_pi_4), c);
    return c;
}

float sd1(in vec2 p) {
    return sdl(p);
}

float sd2(in vec2 p) {
    float c = sdRoundedBox2d(p + vec2(33.75, -677.5), vec2(33.75, 22.5), r225_225_0_0);
    c = min(sdRing2d(rot_mpi_4 * (p + vec2(67.5, -632.5)), n_pi_4), c);
    c = min(sdBox2d(p + vec2(112.5, -566.25), vec2(22.5, 66.25)), c);
    c = min(sdRing2d(rot_m3pi_4 * (p + vec2(67.5, -500.0)), n_pi_4), c);
    c = min(sdRing2d(rot_pi_4 * (p + vec2(67.5, -410.0)), n_pi_4), c);
    c = min(sdBox2d(p + vec2(22.5, -238.75), vec2(22.5, 171.25)), c);
    c = min(sdRoundedBox2d(p + vec2(101.25, -22.5), vec2(33.75, 22.5), r0_0_225_225), c);
    c = min(sdRing2d(rot_3pi_4 * (p + vec2(67.5, -67.5)), n_pi_4), c);
    return c;
}

float sdE(in vec2 p) {
    float c = sdRoundedBox2d(p + vec2(101.25, -677.5), vec2(33.75, 22.5), r0_0_225_225);
    c = min(sdRing2d(rot_pi_4 * (p + vec2(67.5, -632.5)), n_pi_4), c);
    c = min(sdBox2d(p + vec2(22.5, -350.0), vec2(22.5, 282.5)), c);
    c = smin2d(sdBox2d(p + vec2(56.25, -455.0), vec2(11.25, 22.5)), c);
    c = min(sdRoundedBox2d(p + vec2(90.0, -455.0), vec2(22.5), r0_0_225_225), c);
    c = min(sdRoundedBox2d(p + vec2(101.25, -22.5), vec2(33.75, 22.5), r0_0_225_225), c);
    c = min(sdRing2d(rot_3pi_4 * (p + vec2(67.5, -67.5)), n_pi_4), c);
    return c;
}

float sd3(in vec2 p) {
    return sdE(vec2(-p.x - 135.0, p.y));
}

float sd4(in vec2 p) {
    float g = sdRoundedBox2d(p + vec2(112.5, -350.0), vec2(22.5, 350.0), r225);
    g = smin2d(sdBox2d(p + vec2(78.75, -455.0), vec2(11.25, 22.5)), g); 
    g = min(sdRing2d(rot_3pi_4 * (p + vec2(67.5, -500.0)), n_pi_4), g);
    g = min(sdRoundedBox2d(p + vec2(22.5, -600.0), vec2(22.5, 100.0), r225_0_225_0), g);
    return g;
}

float sd5(in vec2 p) {
    float c = sdRing2d(p + vec2(67.5, -67.5), n_mpi_2);
    c = min(sdRoundedBox2d(p + vec2(22.5, -101.25), vec2(22.5, 33.75), r225_0_225_0), c); 
    c = min(sdBox2d(p + vec2(112.5, -238.75), vec2(22.5, 171.25)), c);
    c = min(sdRing2d(rot_3pi_4 * (p + vec2(67.5, -500.0)), n_pi_4), c);
    c = min(sdRing2d(rot_mpi_4 * (p + vec2(67.5, -410.0)), n_pi_4), c);
    c = min(sdBox2d(p + vec2(22.5, -566.25), vec2(22.5, 66.25)), c);
    c = min(sdRing2d(rot_pi_4 * (p + vec2(67.5, -632.5)), n_pi_4), c);
    c = min(sdRoundedBox2d(p + vec2(101.25, -677.5), vec2(33.75, 22.5), r0_0_225_225), c);
    return c;
}

float sd6(in vec2 p) {
    float c = sdRing2d(p + vec2(67.5, -67.5), n_mpi_2); 
    c = min(sdBox2d(p + vec2(22.5, -350.0), vec2(22.5, 282.5)), c); 
    c = smin2d(sdBox2d(p + vec2(56.25, -455.0), vec2(11.25, 22.5)), c);
    c = min(sdRing2d(p + vec2(67.5, -632.5), n_pi_2), c); 
    c = min(sdBox2d(p + vec2(112.5, -238.75), vec2(22.5, 171.25)), c);
    c = min(sdRing2d(rot_mpi_4 * (p + vec2(67.5, -410.0)), n_pi_4), c);
    c = min(sdRoundedBox2d(p + vec2(112.5, -598.75), vec2(22.5, 33.75), r0_225_0_225), c);
    return c;
}

float sd7(in vec2 p) {
    float c = sdRoundedBox2d(p + vec2(33.75, -677.5), vec2(33.75, 22.5), r225_225_0_0);
    c = min(sdRing2d(rot_mpi_4 * (p + vec2(67.5, -632.5)), n_pi_4), c);
    c = min(sdRoundedBox2d(p + vec2(112.5, -316.25), vec2(22.5, 316.25), r0_225_0_225), c);
    return c;
}

float sd8(in vec2 p) {
    float c = sdRing2d(p + vec2(67.5, -67.5), n_mpi_2);
    c = min(sdBox2d(p + vec2(22.5, -350.0), vec2(22.5, 282.5)), c);
    c = smin2d(sdBox2d(p + vec2(56.25, -455.0), vec2(11.25, 22.5)), c);
    c = min(sdRing2d(p + vec2(67.5, -632.5), n_pi_2), c);
    float c2 = sdBox2d(p + vec2(112.5, -350.0), vec2(22.5, 282.5));
    c2 = smin2d(sdBox2d(p + vec2(78.75, -455.0), vec2(11.25, 22.5)), c2);
    c = min(c, c2); 
    return c;
}

float sd9(in vec2 p) {
    float g = sdRing2d(p + vec2(67.5, -632.5), n_pi_2);
    g = min(sdBox2d(p + vec2(112.5, -350.0), vec2(22.5, 282.5)), g);
    g = smin2d(sdBox2d(p + vec2(78.75, -455.0), vec2(11.25, 22.5)), g);
    g = min(sdRing2d(rot_3pi_4 * (p + vec2(67.5, -500.0)), n_pi_4), g);
    g = min(sdBox2d(p + vec2(22.5, -566.25), vec2(22.5, 66.25)), g);
    g = min(sdRing2d(p + vec2(67.5, -67.5), n_mpi_2), g);
    g = min(sdRoundedBox2d(p + vec2(22.5, -101.25), vec2(22.5, 33.75), r225_0_225_0), g);
    return g;
}

float sd0(in vec2 p) {
    float c = sdRing2d(p + vec2(67.5, -67.5), n_mpi_2);
    c = min(sdBox2d(p + vec2(22.5, -350.0), vec2(22.5, 282.5)), c);
    c = min(sdRing2d(p + vec2(67.5, -632.5), n_pi_2), c);
    c = min(sdBox2d(p + vec2(112.5, -350.0), vec2(22.5, 282.5)), c);
    return c;
}

float sdNotDefined(in vec2 p) {
    return sdRoundedBox2d(p + vec2(67.5, -350.0), vec2(67.5, 350.0), r225);
}

// ╔══════════════════════════════════════════════════════════╗
// ║                      Baking logic                        ║
// ╚══════════════════════════════════════════════════════════╝
float getGlyphSdf(int letterCode, vec2 p) {
    switch (letterCode) {
        // lowercase a-z
        case 0: return sda(p);
        case 1: return sdb(p);
        case 2: return sdc(p);
        case 3: return sdd(p);
        case 4: return sde(p);
        case 5: return sdf(p);
        case 6: return sdg(p);
        case 7: return sdh(p);
        case 8: return sdi(p);
        case 9: return sdj(p);
        case 10: return sdk(p);
        case 11: return sdl(p);
        case 12: return sdm(p);
        case 13: return sdn(p);
        case 14: return sdo(p);
        case 15: return sdp(p + vec2(135.0, 0.0));
        case 16: return sdq(p);
        case 17: return sdr(p);
        case 18: return sds(p);
        case 19: return sdt(p);
        case 20: return sdu(p);
        case 21: return sdv(p);
        case 22: return sdw(p);
        case 23: return sdx(p);
        case 24: return sdy(p);
        case 25: return sdz(p);
        // numbers 0-9
        case 26: return sd0(p);
        case 27: return sd1(p);
        case 28: return sd2(p);
        case 29: return sd3(p);
        case 30: return sd4(p);
        case 31: return sd5(p);
        case 32: return sd6(p);
        case 33: return sd7(p);
        case 34: return sd8(p);
        case 35: return sd9(p);
        default: return sdNotDefined(p);
    }
}

void main() {
    /* The letters have the following sizes:                     */
    /*                   │     ┬                                 */
    /* ┌──┐  ┬           ├──┐  │            ┌──┐  ┬              */
    /* │  │  │ 500 units │  │  │ 700 units  │  │  │              */
    /* │  │  │           │  │  │            │  │  │ 700 units    */
    /* └──┘  ┴           └──┘  ┴            └──┤  │              */
    /* ├──┤                                    │  ┴              */
    /* 135 units                                                 */
    /*                                                           */
    /* The stroke width is 45 units for all strokes              */
    vec2 p = mix(uBoxMin, uBoxMax, vUv ) * vec2(-1., 1.); // All my sdf function are mirrored along the x-Axis for some reason
    fragColor = getGlyphSdf(uCharIndex, p);
}