// Optimized Simplex Noise - flattened gradient arrays for cache-friendly access

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;

// Flattened gradient components (avoid array-of-array dereference)
const g3x = new Float64Array([1,-1,1,-1,1,-1,1,-1,0,0,0,0]);
const g3y = new Float64Array([1,1,-1,-1,0,0,0,0,1,-1,1,-1]);
const g3z = new Float64Array([0,0,0,0,1,1,-1,-1,1,1,-1,-1]);

function buildPermutationTable(seed) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    let s = seed;
    for (let i = 255; i > 0; i--) {
        s = (s * 16807) % 2147483647;
        const j = s % (i + 1);
        const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    const perm = new Uint8Array(512);
    const permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
        perm[i] = p[i & 255];
        permMod12[i] = perm[i] % 12;
    }
    return { perm, permMod12 };
}

export class SimplexNoise {
    constructor(seed = 42) {
        const { perm, permMod12 } = buildPermutationTable(seed);
        this.perm = perm;
        this.pm12 = permMod12;
    }

    noise2D(xin, yin) {
        const perm = this.perm, pm12 = this.pm12;
        const s = (xin + yin) * F2;
        const i = Math.floor(xin + s);
        const j = Math.floor(yin + s);
        const t = (i + j) * G2;
        const x0 = xin - (i - t);
        const y0 = yin - (j - t);

        const i1 = x0 > y0 ? 1 : 0;
        const j1 = 1 - i1;

        const x1 = x0 - i1 + G2;
        const y1 = y0 - j1 + G2;
        const x2 = x0 - 1.0 + 2.0 * G2;
        const y2 = y0 - 1.0 + 2.0 * G2;

        const ii = i & 255, jj = j & 255;
        let n0 = 0, n1 = 0, n2 = 0;

        let t0 = 0.5 - x0 * x0 - y0 * y0;
        if (t0 >= 0) {
            const gi = pm12[ii + perm[jj]];
            t0 *= t0;
            n0 = t0 * t0 * (g3x[gi] * x0 + g3y[gi] * y0);
        }
        let t1 = 0.5 - x1 * x1 - y1 * y1;
        if (t1 >= 0) {
            const gi = pm12[ii + i1 + perm[jj + j1]];
            t1 *= t1;
            n1 = t1 * t1 * (g3x[gi] * x1 + g3y[gi] * y1);
        }
        let t2 = 0.5 - x2 * x2 - y2 * y2;
        if (t2 >= 0) {
            const gi = pm12[ii + 1 + perm[jj + 1]];
            t2 *= t2;
            n2 = t2 * t2 * (g3x[gi] * x2 + g3y[gi] * y2);
        }
        return 70.0 * (n0 + n1 + n2);
    }

    noise3D(xin, yin, zin) {
        const perm = this.perm, pm12 = this.pm12;
        const s = (xin + yin + zin) * F3;
        const i = Math.floor(xin + s);
        const j = Math.floor(yin + s);
        const k = Math.floor(zin + s);
        const t = (i + j + k) * G3;
        const x0 = xin - (i - t);
        const y0 = yin - (j - t);
        const z0 = zin - (k - t);

        let i1, j1, k1, i2, j2, k2;
        if (x0 >= y0) {
            if (y0 >= z0)      { i1=1;j1=0;k1=0;i2=1;j2=1;k2=0; }
            else if (x0 >= z0) { i1=1;j1=0;k1=0;i2=1;j2=0;k2=1; }
            else               { i1=0;j1=0;k1=1;i2=1;j2=0;k2=1; }
        } else {
            if (y0 < z0)       { i1=0;j1=0;k1=1;i2=0;j2=1;k2=1; }
            else if (x0 < z0)  { i1=0;j1=1;k1=0;i2=0;j2=1;k2=1; }
            else               { i1=0;j1=1;k1=0;i2=1;j2=1;k2=0; }
        }

        const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
        const x2 = x0 - i2 + 2*G3, y2 = y0 - j2 + 2*G3, z2 = z0 - k2 + 2*G3;
        const x3 = x0 - 1 + 3*G3, y3 = y0 - 1 + 3*G3, z3 = z0 - 1 + 3*G3;

        const ii = i & 255, jj = j & 255, kk = k & 255;
        let n0 = 0, n1 = 0, n2 = 0, n3 = 0;

        let t0 = 0.6 - x0*x0 - y0*y0 - z0*z0;
        if (t0 >= 0) { const gi = pm12[ii + perm[jj + perm[kk]]]; t0 *= t0; n0 = t0*t0*(g3x[gi]*x0+g3y[gi]*y0+g3z[gi]*z0); }
        let t1 = 0.6 - x1*x1 - y1*y1 - z1*z1;
        if (t1 >= 0) { const gi = pm12[ii+i1 + perm[jj+j1 + perm[kk+k1]]]; t1 *= t1; n1 = t1*t1*(g3x[gi]*x1+g3y[gi]*y1+g3z[gi]*z1); }
        let t2 = 0.6 - x2*x2 - y2*y2 - z2*z2;
        if (t2 >= 0) { const gi = pm12[ii+i2 + perm[jj+j2 + perm[kk+k2]]]; t2 *= t2; n2 = t2*t2*(g3x[gi]*x2+g3y[gi]*y2+g3z[gi]*z2); }
        let t3 = 0.6 - x3*x3 - y3*y3 - z3*z3;
        if (t3 >= 0) { const gi = pm12[ii+1 + perm[jj+1 + perm[kk+1]]]; t3 *= t3; n3 = t3*t3*(g3x[gi]*x3+g3y[gi]*y3+g3z[gi]*z3); }

        return 32.0 * (n0 + n1 + n2 + n3);
    }

    fbm2D(x, y, octaves = 6, lacunarity = 2.0, persistence = 0.5) {
        let value = 0, amplitude = 1, frequency = 1, maxValue = 0;
        for (let i = 0; i < octaves; i++) {
            value += amplitude * this.noise2D(x * frequency, y * frequency);
            maxValue += amplitude;
            amplitude *= persistence;
            frequency *= lacunarity;
        }
        return value / maxValue;
    }

    fbm3D(x, y, z, octaves = 4, lacunarity = 2.0, persistence = 0.5) {
        let value = 0, amplitude = 1, frequency = 1, maxValue = 0;
        for (let i = 0; i < octaves; i++) {
            value += amplitude * this.noise3D(x * frequency, y * frequency, z * frequency);
            maxValue += amplitude;
            amplitude *= persistence;
            frequency *= lacunarity;
        }
        return value / maxValue;
    }
}
