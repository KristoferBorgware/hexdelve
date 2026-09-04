// synth.js — the shared DSP floor under the dungeon tracks.
//
// Nothing in here knows anything about a particular piece of music: it is
// oscillator maths, filters, a room, and a WAV writer. The tracks themselves
// own their voices and their arrangement.
//
//   const S = require('./synth')({ LEN: 180, TAIL: 9 });
//
// Everything is bound to one set of constants so the tracks never have to
// pass a sample rate around.

module.exports = function createSynth({ SR = 44100, LEN, TAIL, XF = 4 }) {
  const N = Math.round(LEN * SR);          // samples in the loop
  const NT = Math.round((LEN + TAIL) * SR); // plus room for the tail
  const XFN = Math.round(XF * SR);          // noise-bed crossfade

  // -------------------------------------------------------------- numbers

  function mulberry32(a) {
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  // Snap a frequency to a whole number of cycles per loop. Any sustained
  // oscillator that skips this will click at the splice.
  const loopq = f => Math.round(f * LEN) / LEN;

  const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
  const smooth = x => { x = clamp01(x); return x * x * (3 - 2 * x); };

  // equal-power pan, p in [-1, 1]
  function pan2(p) {
    const a = (p + 1) * Math.PI / 4;
    return [Math.cos(a), Math.sin(a)];
  }

  // -------------------------------------------------------------- filters

  // Fold the extra XFN samples back over the head, equal power. Noise beds
  // are stationary, so this is all it takes to make them loop.
  function crossfadeLoop(buf) {
    const out = new Float32Array(N);
    out.set(buf.subarray(0, N));
    for (let n = 0; n < XFN; n++) {
      const x = n / XFN;
      out[n] = out[n] * Math.sin(x * Math.PI / 2) + buf[N + n] * Math.cos(x * Math.PI / 2);
    }
    return out;
  }

  // One-pole highpass run twice over the loop: the first sweep only settles
  // the state, so the filter is periodic and the loop point survives it.
  function hpLoop(x, fc) {
    const M = x.length;
    const a = 1 / (1 + 2 * Math.PI * fc / SR);
    let y = 0, prev = x[M - 1];
    for (let n = 0; n < M; n++) { y = a * (y + x[n] - prev); prev = x[n]; }
    prev = x[M - 1];
    for (let n = 0; n < M; n++) { const xn = x[n]; y = a * (y + xn - prev); prev = xn; x[n] = y; }
  }

  // Chamberlin state-variable filter step. Returns the bandpass output and
  // mutates the state — stable under fast cutoff modulation, which is why
  // every sweeping voice uses it instead of a biquad.
  function svf(st, input, fc, q) {
    const f = 2 * Math.sin(Math.PI * Math.min(fc, SR * 0.24) / SR);
    const high = input - st.low - q * st.band;
    st.band += f * high;
    st.low += f * st.band;
    // resonance can run away on a modulated sweep; keep it in the room
    if (st.band > 8) st.band = 8; else if (st.band < -8) st.band = -8;
    if (st.low > 8) st.low = 8; else if (st.low < -8) st.low = -8;
    return st.band;
  }
  // The same filter's lowpass output. A bandpass throws the fundamental away,
  // which is right for colouring noise and wrong for a bowed string — anything
  // that should keep its bottom wants this one.
  function svfLP(st, input, fc, q) {
    svf(st, input, fc, q);
    return st.low;
  }

  const svfState = () => ({ low: 0, band: 0 });

  // ----------------------------------------------------------- the rooms

  // Schroeder: damped combs in parallel into a chain of allpasses. The
  // damping in the feedback path is what turns a metal tank into wet stone.
  function reverb(x, combs, aps, rt60, damp) {
    const M = x.length;
    const out = new Float32Array(M);
    for (const D of combs) {
      const g = Math.pow(10, (-3 * D) / (rt60 * SR));
      const buf = new Float32Array(D);
      let p = 0, lp = 0;
      for (let n = 0; n < M; n++) {
        const y = buf[p];
        out[n] += y;
        lp += damp * (y - lp);
        buf[p] = x[n] + lp * g;
        p = p + 1 === D ? 0 : p + 1;
      }
    }
    for (let n = 0; n < M; n++) out[n] *= 0.25;
    for (const D of aps) {
      const buf = new Float32Array(D);
      const g = 0.62;
      let p = 0;
      for (let n = 0; n < M; n++) {
        const bo = buf[p];
        const v = out[n] - bo * g;
        buf[p] = v;
        out[n] = bo + v * g;
        p = p + 1 === D ? 0 : p + 1;
      }
    }
    return out;
  }

  function predelay(x, ms) {
    const d = Math.round(ms * SR / 1000);
    const out = new Float32Array(x.length);
    out.set(x.subarray(0, x.length - d), d);
    return out;
  }

  // Cross-fed delay: left feeds right feeds left, so repeats walk across the
  // stereo field. This is the sound of a corridor rather than a chamber.
  function pingpong(inL, inR, msL, msR, fb, damp) {
    const M = inL.length;
    const dL = Math.round(msL * SR / 1000), dR = Math.round(msR * SR / 1000);
    const bufL = new Float32Array(dL), bufR = new Float32Array(dR);
    const outL = new Float32Array(M), outR = new Float32Array(M);
    let pl = 0, pr = 0, lpL = 0, lpR = 0;
    for (let n = 0; n < M; n++) {
      const yL = bufL[pl], yR = bufR[pr];
      outL[n] = yL; outR[n] = yR;
      lpL += damp * (yR - lpL);          // the cross-feed
      lpR += damp * (yL - lpR);
      bufL[pl] = inL[n] + lpL * fb;
      bufR[pr] = inR[n] + lpR * fb;
      pl = pl + 1 === dL ? 0 : pl + 1;
      pr = pr + 1 === dR ? 0 : pr + 1;
    }
    return [outL, outR];
  }

  // ---------------------------------------------------------------- output

  // Soft saturation, then report the gain that lands the peak at `target`.
  function master(outL, outR, target = 0.89, drive = 0.9) {
    let peak = 0;
    for (let n = 0; n < N; n++) {
      outL[n] = Math.tanh(outL[n] * drive) / drive;
      outR[n] = Math.tanh(outR[n] * drive) / drive;
      peak = Math.max(peak, Math.abs(outL[n]), Math.abs(outR[n]));
    }
    return { peak, gain: peak > 0 ? target / peak : 1 };
  }

  function writeWav(outPath, outL, outR, gain) {
    const data = Buffer.alloc(N * 4);
    for (let n = 0; n < N; n++) {
      const l = Math.max(-1, Math.min(1, outL[n] * gain));
      const r = Math.max(-1, Math.min(1, outR[n] * gain));
      data.writeInt16LE((l * 32767) | 0, n * 4);
      data.writeInt16LE((r * 32767) | 0, n * 4 + 2);
    }
    const h = Buffer.alloc(44);
    h.write('RIFF', 0);
    h.writeUInt32LE(36 + data.length, 4);
    h.write('WAVE', 8);
    h.write('fmt ', 12);
    h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20);
    h.writeUInt16LE(2, 22);
    h.writeUInt32LE(SR, 24);
    h.writeUInt32LE(SR * 4, 28);
    h.writeUInt16LE(4, 32);
    h.writeUInt16LE(16, 34);
    h.write('data', 36);
    h.writeUInt32LE(data.length, 40);
    require('fs').writeFileSync(outPath, Buffer.concat([h, data]));
    return data.length;
  }

  return {
    SR, LEN, TAIL, N, NT, XFN,
    mulberry32, mtof, loopq, clamp01, smooth, pan2,
    crossfadeLoop, hpLoop, svf, svfLP, svfState,
    reverb, predelay, pingpong,
    master, writeWav,
  };
};
