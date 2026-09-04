// dungeon-pursuit.js — moving, and not fast enough.
//
// The gap between the town and the cells: 96 BPM, halfway between town's lilt
// and the prison's crawl, but pushed instead of relaxed. Background music for
// a level you are crossing rather than searching — it never resolves and it
// never stops moving, and it is not combat, because combat means the thing
// has already caught you.
//
// D phrygian, like dungeon-crawl and combat, but the harmony changes every
// bar instead of every two, which is most of where the restlessness comes
// from. Nothing here sits still long enough to feel settled.
//
// No noise beds. Everything you hear is played.
//
//   npm run audio -- dungeon-pursuit
//   node public/assets/audio/dungeon-pursuit.js [out.wav]

const path = require('path');

const BAR = 2.5;                  // 4/4 at 96 BPM
const BEAT = BAR / 4;             // 0.625 s
const E = BAR / 8;                // eighth
const SX = BAR / 16;              // sixteenth, 0.15625 s
const BARS = 64;
const LEN = BARS * BAR;           // 160 s exactly
const TAIL = 7;

const S = require('./synth')({ LEN, TAIL });
const { SR, N, NT, mulberry32, mtof, loopq, smooth, pan2, svf, svfLP, svfState } = S;

const rnd = mulberry32(0x9f1ee);

// ------------------------------------------------------------------ buses

const dryL = new Float32Array(NT), dryR = new Float32Array(NT);
const wetL = new Float32Array(NT), wetR = new Float32Array(NT);
const echL = new Float32Array(NT), echR = new Float32Array(NT);

const SOLO = process.env.SOLO ? process.env.SOLO.split(',') : null;
const on = g => !SOLO || SOLO.includes(g);
let group = '';

function place(i, v, l, r, send, echo = 0) {
  if (i >= NT || !on(group)) return;
  const vl = v * l, vr = v * r;
  dryL[i] += vl; dryR[i] += vr;
  wetL[i] += vl * send; wetR[i] += vr * send;
  if (echo) { echL[i] += vl * echo; echR[i] += vr * echo; }
}

const { breath, growl, pluck } = require('./voices')({ S, place, rnd });
const dampFor = t60 => Math.exp(-6.9078 / (t60 * SR));

// ------------------------------------------------------------------- notes

const D1 = 26, D2 = 38, Eb2 = 39, F2 = 41, G2 = 43, A2 = 45, Bb2 = 46, C3 = 48,
      D3 = 50, Eb3 = 51, F3 = 53, G3 = 55, Ab3 = 56, A3 = 57, Bb3 = 58, C4 = 60,
      D4 = 62, Eb4 = 63, F4 = 65, G4 = 67, Ab4 = 68, A4 = 69, Bb4 = 70, C5 = 72,
      D5 = 74, Eb5 = 75, A5 = 81;

// D phrygian: D Eb F G A Bb C
const CH = {
  Dm: { root: D2, notes: [D3, F3, A3, D4] },
  Eb: { root: Eb2, notes: [Eb3, G3, Bb3, Eb4] },
  F:  { root: F2, notes: [F3, A3, C4, F4] },
  Gm: { root: G2, notes: [G3, Bb3, D4, G4] },
  Bb: { root: Bb2, notes: [Bb2, D3, F3, Bb3] },
  C:  { root: C3, notes: [C3, Eb3, G3, C4] },
};

// One chord per bar. Combat moves every two; this moves every one, and that
// alone is most of the difference in how hard it pushes.
const PROG_A = ['Dm', 'Eb', 'Dm', 'C', 'Dm', 'F', 'Bb', 'C'];
const PROG_B = ['Gm', 'F', 'Eb', 'Dm', 'Gm', 'Eb', 'C', 'Dm'];
const usesB = bar => (bar >= 24 && bar < 40) || (bar >= 48 && bar < 56);
const chordAt = bar => CH[(usesB(bar) ? PROG_B : PROG_A)[bar % 8]];

// ------------------------------------------------------------------ voices

// The engine: a short, hard, filtered note on every other sixteenth. Not a
// plucked-string model — Karplus-Strong excites its delay line with a burst of
// noise, and at sixteen notes to the bar those seven hundred bursts add up to a
// broadband haze that puts pitches in the mix the key does not contain. Two
// detuned saws and a closing filter give the same muted attack out of purely
// harmonic material.
function muted(t, midi, amp, panPos) {
  const start = Math.round(t * SR);
  if (start >= N || start < 0) return;
  const f = mtof(midi);
  const [l, r] = pan2(panPos);
  const dur = Math.round(0.42 * SR);
  const atk = Math.round(0.004 * SR);
  const phs = [rnd(), rnd()];
  const dets = [1, 1.0031];
  const st = svfState();
  for (let n = 0; n < dur && start + n < NT; n++) {
    const t2 = n / SR;
    let saw = 0;
    for (let k = 0; k < 2; k++) {
      phs[k] += f * dets[k] / SR; if (phs[k] >= 1) phs[k] -= 1;
      saw += (2 * phs[k] - 1) * 0.5;
    }
    const e = (n < atk ? n / atk : 1) * Math.exp(-t2 / 0.085);
    const cut = 520 + 1900 * Math.exp(-t2 / 0.035);
    place(start + n, svfLP(st, saw, cut, 0.9) * amp * e, l, r, 0.16, 0.06);
  }
}

// A shawm — the medieval double reed. A narrow pulse is what makes it: the
// narrower the reed's opening, the more upper harmonics, which is why a shawm
// carries across a battlefield and a recorder does not. Nasal, and it cuts.
function shawm(t, midi, dur, amp, panPos, send) {
  const start = Math.round(t * SR);
  if (start >= N || start < 0) return;
  const f = mtof(midi);
  const [l, r] = pan2(panPos);
  const total = Math.round(dur * SR);
  const atk = Math.round(0.022 * SR), rel = Math.round(0.05 * SR);
  const st1 = svfState(), st2 = svfState(), stn = svfState();
  const vibP = rnd() * 6.28;
  let ph = 0, ph2 = 0;
  for (let n = 0; n < total && start + n < NT; n++) {
    const t2 = n / SR;
    // the reed never holds a perfectly steady pitch
    const vib = 1 + 0.0035 * Math.sin(2 * Math.PI * 5.8 * t2 + vibP) * smooth((t2 - 0.06) / 0.2)
                  + 0.0018 * Math.sin(2 * Math.PI * 13.3 * t2);
    ph += f * vib / SR; if (ph >= 1) ph -= 1;
    ph2 = ph + 0.17; if (ph2 >= 1) ph2 -= 1;          // pulse width
    const pulse = (2 * ph - 1) - (2 * ph2 - 1);
    const body = svfLP(st1, pulse * 0.5, 2400, 0.5);
    const cry = svf(st2, pulse * 0.5, 1450, 0.22) * 0.45;   // the reed's peak
    const reed = svf(stn, rnd() * 2 - 1, 2600, 0.6) * (0.03 + 0.10 * Math.exp(-t2 / 0.03));
    const e = n < atk ? smooth(n / atk)
            : n > total - rel ? smooth((total - n) / rel) : 1;
    place(start + n, (body + cry + reed) * amp * e, l, r, send, 0.22);
  }
}

// The gurdy again, but this time played the way it is meant to be at tempo.
function wheel(t, midi, dur, amp, panPos, send) {
  const start = Math.round(t * SR);
  if (start >= N || start < 0) return;
  const f = mtof(midi);
  const [l, r] = pan2(panPos);
  const total = Math.round(dur * SR);
  const atk = Math.round(1.1 * SR), rel = Math.round(1.6 * SR);
  const parts = [{ m: 1, g: 1.0 }, { m: 1.4983, g: 0.52 }, { m: 2, g: 0.28 }];
  const phs = parts.map(() => rnd());
  const st = svfState();
  const rev = 0.9 + rnd() * 0.2, revP = rnd() * 6.28;
  for (let n = 0; n < total && start + n < NT; n++) {
    const t2 = n / SR;
    const turn = 2 * Math.PI * rev * t2 + revP;
    const press = 0.74 + 0.18 * Math.sin(turn) + 0.08 * Math.sin(2 * turn + 1.1);
    let saw = 0;
    for (let k = 0; k < parts.length; k++) {
      phs[k] += f * parts[k].m / SR; if (phs[k] >= 1) phs[k] -= 1;
      saw += (2 * phs[k] - 1) * parts[k].g;
    }
    const e = n < atk ? smooth(n / atk)
            : n > total - rel ? smooth((total - n) / rel) : 1;
    place(start + n, svfLP(st, saw * 0.42, 440 + 320 * press, 0.85) * amp * e * press,
          l, r, send, 0.08);
  }
}

// The trompette: a gurdy's buzzing bridge. Jerk the wheel and the bridge
// chatters against the soundboard — a rasp on the beat, and the only
// percussion a hurdy-gurdy has. This is the sound that makes the instrument
// dance rather than drone.
function buzz(t, midi, amp, panPos) {
  const start = Math.round(t * SR);
  if (start >= N || start < 0) return;
  const f = mtof(midi);
  const [l, r] = pan2(panPos);
  const dur = Math.round(0.16 * SR);
  const st = svfState();
  let ph = 0;
  for (let n = 0; n < dur && start + n < NT; n++) {
    const t2 = n / SR;
    ph += f * 2 / SR; if (ph >= 1) ph -= 1;
    // hard-clipped, so the bridge is rattling rather than sounding
    let v = Math.tanh((2 * ph - 1) * 6);
    v = svf(st, v, 1900 + 900 * Math.exp(-t2 / 0.02), 0.30);
    place(start + n, v * amp * Math.exp(-t2 / 0.030), l, r, 0.28, 0.10);
  }
}

// Low drum, dry and close. No cavern on this one; it has to move.
function lowHit(t, amp, panPos) {
  const start = Math.round(t * SR);
  if (start >= N || start < 0) return;
  const [l, r] = pan2(panPos);
  const dur = Math.round(0.6 * SR);
  let ph = 0, lp = 0;
  for (let n = 0; n < dur && start + n < NT; n++) {
    const t2 = n / SR;
    ph += 2 * Math.PI * (52 + 66 * Math.exp(-t2 / 0.026)) / SR;
    lp += 0.32 * ((rnd() * 2 - 1) - lp);
    place(start + n, (Math.sin(ph) * Math.exp(-t2 / 0.16)
                      + lp * Math.exp(-t2 / 0.010) * 0.35) * amp, l, r, 0.20);
  }
}

// A tom, tuned and open, for the offbeats.
function tom(t, midi, amp, panPos) {
  const start = Math.round(t * SR);
  if (start >= N || start < 0) return;
  const f = mtof(midi);
  const [l, r] = pan2(panPos);
  const dur = Math.round(0.7 * SR);
  const st = svfState();
  let ph = 0;
  for (let n = 0; n < dur && start + n < NT; n++) {
    const t2 = n / SR;
    ph += 2 * Math.PI * f * (1 + 0.12 * Math.exp(-t2 / 0.018)) / SR;
    const skin = svf(st, rnd() * 2 - 1, f * 4, 0.55) * Math.exp(-t2 / 0.030) * 0.45;
    place(start + n, (Math.sin(ph) * Math.exp(-t2 / 0.13) + skin) * amp, l, r, 0.30, 0.08);
  }
}

// Woodblock. Dry, wooden, and it takes the sixteenths — nothing metallic, so
// it does not turn into the shaker every other track already has.
function tick(t, amp, panPos, midi = D5) {
  const start = Math.round(t * SR);
  if (start >= N || start < 0) return;
  const [l, r] = pan2(panPos);
  const dur = Math.round(0.09 * SR);
  const st = svfState();
  const f = mtof(midi + 12) * (1 + (rnd() - 0.5) * 0.012);   // in the key, not at random
  let ph = 0;
  for (let n = 0; n < dur && start + n < NT; n++) {
    const t2 = n / SR;
    ph += 2 * Math.PI * f / SR;
    const wood = Math.sin(ph) * Math.exp(-t2 / 0.012);
    const knock = svf(st, rnd() * 2 - 1, 2400, 0.55) * Math.exp(-t2 / 0.0035) * 0.6;
    place(start + n, (wood + knock) * amp, l, r, 0.24);
  }
}

// A voice, used as percussion. Short, low, breathy chest hits on the accents —
// people rather than a synth, which is what keeps a driving loop from sounding
// mechanical.
const VOXF = [[520, 1.0], [1080, 0.45], [2400, 0.10]];
function voxStab(t, midi, dur, amp, panPos, send) {
  const start = Math.round(t * SR);
  if (start >= N || start < 0) return;
  const f = mtof(midi);
  const [l, r] = pan2(panPos);
  const total = Math.round(dur * SR);
  const st = VOXF.map(svfState);
  let ph = 0, lp = 0;
  for (let n = 0; n < total && start + n < NT; n++) {
    const t2 = n / SR;
    ph += f * (1 + 0.02 * Math.exp(-t2 / 0.04)) / SR; if (ph >= 1) ph -= 1;
    let src = 2 * ph - 1;
    lp += 0.20 * (src - lp);
    src = lp + (rnd() * 2 - 1) * 0.10;
    let out = 0;
    for (let k = 0; k < VOXF.length; k++) out += svf(st[k], src, VOXF[k][0], 0.18) * VOXF[k][1];
    const e = (1 - Math.exp(-t2 / 0.012)) * Math.exp(-t2 / (dur * 0.34));
    place(start + n, out * 0.5 * amp * e, l, r, send, 0.18);
  }
}

// High cluster, shaking. Tension, held above everything else.
function tremolo(t, midis, dur, amp, send) {
  const start = Math.round(t * SR);
  if (start >= N || start < 0) return;
  const total = Math.round(dur * SR);
  const vs = midis.map((m, i) => ({
    f: mtof(m) * (1 + (rnd() - 0.5) * 0.006), ph: rnd(),
    pan: (i / Math.max(1, midis.length - 1)) * 1.5 - 0.75,
    st: svfState(), tr: 12 + rnd() * 5, trP: rnd() * 6.28,
  }));
  const atk = total * 0.2, rel = total * 0.35;
  for (let n = 0; n < total && start + n < NT; n++) {
    const t2 = n / SR;
    const e = n < atk ? smooth(n / atk) : smooth((total - n) / rel);
    for (const v of vs) {
      v.ph += v.f / SR; if (v.ph >= 1) v.ph -= 1;
      const bow = 0.45 + 0.55 * Math.abs(Math.sin(Math.PI * v.tr * t2 + v.trP));
      const s = svfLP(v.st, 2 * v.ph - 1, v.f * 3.2, 0.95) * bow;
      const [l, r] = pan2(v.pan);
      place(start + n, s * amp * e * 0.5, l, r, send, 0.10);
    }
  }
}

// An iron accent, for the top of a phrase.
const BAR_MODES = [[1, 1.00, 4.5], [2.76, 0.60, 2.2], [5.40, 0.28, 1.0], [8.93, 0.13, 0.5]];
function ironBar(t, midi, amp, panPos, send) {
  const start = Math.round(t * SR);
  if (start >= N || start < 0) return;
  const f0 = mtof(midi);
  const [l, r] = pan2(panPos);
  const dur = Math.round(6 * SR);
  const parts = BAR_MODES.map(([ratio, g, tau]) => ({
    w1: 2 * Math.PI * f0 * ratio / SR,
    w2: 2 * Math.PI * (f0 * ratio + 0.4 + rnd()) / SR, ph: rnd() * 6.28, g, tau,
  }));
  const st = svfState();
  for (let n = 0; n < dur && start + n < NT; n++) {
    const t2 = n / SR;
    let s = 0;
    for (const p of parts) {
      s += (Math.sin(p.w1 * n + p.ph) + Math.sin(p.w2 * n)) * 0.5 * p.g * Math.exp(-t2 / p.tau);
    }
    const hit = svf(st, rnd() * 2 - 1, f0 * 6, 0.30) * Math.exp(-t2 / 0.009) * 0.7;
    place(start + n, (s * 0.4 + hit) * amp, l, r, send, 0.28);
  }
}

// A tonal drone, and the only unplayed thing in the piece.
function renderDrone(channelSeed) {
  const src = new Float32Array(N), dst = new Float32Array(N);
  const voices = [
    { midi: D1, amp: 0.34, det: 0.09 }, { midi: D1, amp: 0.30, det: -0.11 },
    { midi: A2, amp: 0.14, det: 0.06 }, { midi: D2, amp: 0.13, det: -0.05 },
  ];
  for (const v of voices) {
    const f = loopq(mtof(v.midi) + v.det + channelSeed);
    const w = 2 * Math.PI * f / SR;
    const ph = rnd() * Math.PI * 2;
    for (let n = 0; n < N; n++) {
      const t = w * n + ph;
      src[n] += v.amp * (Math.sin(t) + 0.22 * Math.sin(2 * t) + 0.09 * Math.sin(3 * t));
    }
  }
  const lfo1 = 2 * Math.PI * loopq(1 / 23) / SR;
  const lfo3 = 2 * Math.PI * loopq(1 / 31) / SR;
  let lp = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let n = 0; n < N; n++) {
      const cut = 132 + 58 * Math.sin(lfo1 * n);
      lp += (1 - Math.exp(-2 * Math.PI * cut / SR)) * (src[n] - lp);
      if (pass) dst[n] = lp * (0.80 + 0.20 * Math.sin(lfo3 * n));
    }
  }
  return dst;
}

// -------------------------------------------------------------------- tune

// Four bars, restless: it keeps reaching up and getting pulled back down to D
// through the flat second. [eighth, midi, length in eighths]
const MOTIF = [
  [0, D4, 2], [2, Eb4, 1], [3, D4, 1], [4, F4, 2], [6, D4, 2],
  [8, A4, 2], [10, G4, 1], [11, F4, 1], [12, Eb4, 4],
  [16, D4, 1], [17, F4, 1], [18, A4, 2], [20, C5, 2], [22, A4, 2],
  [24, G4, 2], [26, F4, 2], [28, Eb4, 2], [30, D4, 2],
];

// ------------------------------------------------------------------- score

// which sixteenths the pulse strikes, and how hard
const PULSE = [1.0, 0, 0.55, 0.62, 0.85, 0, 0.58, 0.55,
               0.92, 0, 0.55, 0.60, 0.80, 0.52, 0.62, 0.58];
// which chord tone, so the pulse outlines the harmony instead of hammering one note
const PTONE = [0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0, 0, 2, 0, 1];

const SECTIONS = [
  { at: 0,  pul: 0.90, drum: 0.85, tk: 0.7, wheel: 0.78, buzz: 0.72, mel: null,  trem: 0.25, vox: 0.4 },
  { at: 8,  pul: 0.95, drum: 0.85, tk: 0.7, wheel: 0.80, buzz: 0.7,  mel: null,  trem: 0,    vox: 0 },
  { at: 16, pul: 1.00, drum: 0.90, tk: 0.8, wheel: 0.85, buzz: 0.85, mel: MOTIF, trem: 0.3, vox: 0.5 },
  { at: 24, pul: 1.00, drum: 0.95, tk: 0.85, wheel: 0.90, buzz: 0.9, mel: MOTIF, trem: 0.4, vox: 0.7 },
  { at: 32, pul: 0.72, drum: 0.56, tk: 0.45, wheel: 0.60, buzz: 0.45, mel: null,  trem: 0.8, vox: 0.45 },
  { at: 40, pul: 0.95, drum: 0.90, tk: 0.8, wheel: 0.85, buzz: 0.85, mel: MOTIF, trem: 0.4, vox: 0.7 },
  { at: 48, pul: 1.00, drum: 1.00, tk: 0.9, wheel: 0.95, buzz: 1.0,  mel: MOTIF, trem: 0.5, vox: 0.9 },
  { at: 56, pul: 0.90, drum: 0.85, tk: 0.7, wheel: 0.75, buzz: 0.7,  mel: null,  trem: 0.3, vox: 0.4 },
];
const sectionAt = bar => { let s = SECTIONS[0]; for (const c of SECTIONS) if (bar >= c.at) s = c; return s; };

const jit = () => (rnd() - 0.5) * 0.008;
const vary = (d = 0.12) => 1 - d * rnd();

group = 'pulse';
for (let bar = 0; bar < BARS; bar++) {
  const sec = sectionAt(bar), ch = chordAt(bar);
  if (!sec.pul) continue;
  for (let i = 0; i < 16; i++) {
    if (!PULSE[i]) continue;
    muted(bar * BAR + i * SX + jit(), ch.notes[PTONE[i]] - 12,
          0.42 * sec.pul * PULSE[i] * vary(), -0.28 + (i % 2) * 0.5);
  }
}

group = 'drums';
for (let bar = 0; bar < BARS; bar++) {
  const sec = sectionAt(bar);
  if (!sec.drum) continue;
  const b = bar * BAR;
  lowHit(b + jit(), 1.05 * sec.drum * vary(0.08), -0.10);
  lowHit(b + 2 * BEAT + jit(), 0.82 * sec.drum * vary(0.12), -0.06);
  if (bar % 2 === 1) lowHit(b + 3 * BEAT + 2 * SX + jit(), 0.62 * sec.drum * vary(0.15), -0.16);
  tom(b + BEAT + jit(), G2, 0.60 * sec.drum * vary(0.10), 0.24);
  tom(b + 3 * BEAT + jit(), F2, 0.64 * sec.drum * vary(0.10), 0.20);
  if (bar % 4 === 3) tom(b + 3 * BEAT + 2 * SX + jit(), Eb2, 0.48 * sec.drum, -0.26);
  // a fill driving into every eighth bar
  if (bar % 8 === 7 && sec.drum > 0.5) {
    for (const s16 of [10, 11, 12, 13, 14, 15]) {
      tom(b + s16 * SX + jit(), [G2, F2, Eb2][s16 % 3], 0.42 * sec.drum * (0.5 + s16 / 20),
          0.2 - (s16 % 3) * 0.25);
    }
  }
}

group = 'tick';
for (let bar = 0; bar < BARS; bar++) {
  const sec = sectionAt(bar);
  if (!sec.tk) continue;
  for (let i = 0; i < 16; i++) {
    if (i % 4 === 0) continue;                 // stay off the strong beats
    if (rnd() < 0.22) continue;
    tick(bar * BAR + i * SX + jit(), 0.140 * sec.tk * (i % 2 ? 0.7 : 1) * vary(0.3),
         (rnd() - 0.5) * 1.3, i % 8 === 4 ? A4 : D5);
  }
}

group = 'wheel';
for (let bar = 0; bar < BARS; bar += 8) {
  const sec = sectionAt(bar);
  if (!sec.wheel) continue;
  wheel(bar * BAR, D2, BAR * 8 * 0.97, 0.125 * sec.wheel, -0.40, 0.42);
  wheel(bar * BAR + 0.3, A2, BAR * 8 * 0.92, 0.070 * sec.wheel, 0.46, 0.46);
}

group = 'buzz';
for (let bar = 0; bar < BARS; bar++) {
  const sec = sectionAt(bar);
  if (!sec.buzz) continue;
  // the trompette rasps on the beat, harder on one and three
  for (const [bt, g] of [[0, 1.0], [1, 0.6], [2, 0.85], [3, 0.6]]) {
    buzz(bar * BAR + bt * BEAT + jit(), D3, 0.25 * sec.buzz * g * vary(0.2), 0.30);
  }
  if (bar % 2 === 1) buzz(bar * BAR + 3 * BEAT + 2 * SX + jit(), D3, 0.16 * sec.buzz, -0.34);
}

group = 'shawm';
for (const sec of SECTIONS) {
  if (!sec.mel) continue;
  for (const [e8, midi, len] of sec.mel) {
    shawm(sec.at * BAR + e8 * E + jit(), midi, len * E * 0.90,
          0.048 * vary(0.10), (rnd() - 0.5) * 0.35, 0.36);
  }
}

group = 'vox';
for (let bar = 0; bar < BARS; bar++) {
  const sec = sectionAt(bar), ch = chordAt(bar);
  if (!sec.vox) continue;
  if (bar % 2) continue;
  voxStab(bar * BAR + jit(), ch.root + 12, 0.45, 0.28 * sec.vox * vary(), -0.18, 0.44);
  if (sec.vox > 0.6) voxStab(bar * BAR + 2 * BEAT + SX + jit(), ch.root + 19, 0.32,
                             0.175 * sec.vox * vary(), 0.26, 0.48);
}

group = 'tremolo';
for (const sec of SECTIONS) {
  if (!sec.trem) continue;
  const ch = chordAt(sec.at);
  tremolo(sec.at * BAR, [ch.notes[0] + 24, ch.notes[1] + 24, ch.notes[0] + 25],
          BAR * 8 * 0.95, 0.070 * sec.trem, 0.58);
}

group = 'iron';
for (const bar of [16, 32, 40, 48, 56]) {
  ironBar(bar * BAR + jit(), [D3, Eb3, G3, D3, C3][[16, 32, 40, 48, 56].indexOf(bar)],
          0.105, (rnd() * 2 - 1) * 0.7, 0.78);
}

// Two short passages of it, and no more — on a loop this is the first thing
// that would start to grate.
group = 'breath';
breath(32 * BAR + 0.5, 4, 1.35, 0.060, 0.30);
breath(56 * BAR + 0.4, 3, 1.25, 0.048, -0.28);

group = 'growl';
growl(33 * BAR, 4.5, 46, 0.40, -0.30, 0.60, 0.24);
growl(52 * BAR + 1.2, 3.2, 43, 0.34, 0.35, 0.50, 0.18);

// --------------------------------------------------------- echo + the room

// Three and four sixteenths, so the repeats land on the grid.
const [ecL, ecR] = S.pingpong(echL, echR, SX * 3000, SX * 4000, 0.28, 0.46);
for (let n = 0; n < NT; n++) {
  dryL[n] += ecL[n] * 0.32; wetL[n] += ecL[n] * 0.44;
  dryR[n] += ecR[n] * 0.32; wetR[n] += ecR[n] * 0.44;
}

// Stone, but not a cathedral. At this tempo anything longer smears the pulse.
function shapeWet(x) {
  const kl = 1 - Math.exp(-2 * Math.PI * 4400 / SR);
  let lp = 0, hp = 0, prev = 0;
  for (let n = 0; n < x.length; n++) {
    lp += kl * (x[n] - lp);
    hp = 0.9935 * (hp + lp - prev); prev = lp;
    x[n] = hp;
  }
}

const rvL = S.reverb(S.predelay(wetL, 20), [2081, 2371, 2683, 2969], [307, 131, 61], 2.3, 0.35);
const rvR = S.reverb(S.predelay(wetR, 24), [2137, 2423, 2741, 3037], [313, 139, 67], 2.3, 0.35);
shapeWet(rvL); shapeWet(rvR);

// ---------------------------------------------------------------- the mix

const outL = new Float32Array(NT), outR = new Float32Array(NT);
for (let n = 0; n < NT; n++) {
  outL[n] = dryL[n] * 0.76 + rvL[n] * 0.52;
  outR[n] = dryR[n] * 0.76 + rvR[n] * 0.52;
}

for (let n = 0; n < NT - N; n++) {
  outL[n] += outL[N + n];
  outR[n] += outR[N + n];
}

if (on('beds')) {
  const droL = renderDrone(0.000), droR = renderDrone(0.021);
  for (let n = 0; n < N; n++) {
    const g = 0.20 + 0.12 * sectionAt(Math.floor(n / SR / BAR)).pul;
    outL[n] += droL[n] * g;
    outR[n] += droR[n] * g;
  }
}

const loopL = outL.subarray(0, N), loopR = outR.subarray(0, N);
S.hpLoop(loopL, 28); S.hpLoop(loopL, 28);
S.hpLoop(loopR, 28); S.hpLoop(loopR, 28);

const { peak, gain } = S.master(outL, outR, 0.89, 1.2);

const gainFile = path.join(__dirname, '.mixgain-pursuit');
if (!SOLO) require('fs').writeFileSync(gainFile, String(gain));
const g2 = SOLO ? Number(require('fs').readFileSync(gainFile, 'utf8')) : gain;

// ------------------------------------------------------------- write wave

const outPath = process.argv[2] || path.join(__dirname, 'dungeon-pursuit.wav');
const bytes = S.writeWav(outPath, outL, outR, g2);

console.log(`${outPath}  ${LEN}s  ${BARS} bars @96BPM  ${SR}Hz stereo  peak ${(peak * gain).toFixed(3)}  ${(bytes / 1048576).toFixed(1)} MB`);
