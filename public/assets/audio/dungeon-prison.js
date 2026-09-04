// dungeon-prison.js — the cells. Something was put down here and left.
//
// A level you live in rather than a scene you watch, so it is built on a
// cycle instead of a story: a slow ground bass, eight bars long, going round
// five times. No scripted footsteps, no door that opens and shuts — that kind
// of thing gives itself away the second time you hear it.
//
// The ground is the descending tetrachord D-C-Bb-A. It is the lament bass:
// four hundred years of writing grief and captivity over exactly that figure,
// and it still works, because it is a line that keeps falling and keeps
// starting again from the same place.
//
// D aeolian rather than the phrygian of dungeon-crawl and combat. One note
// different — E natural where they have Eb — and it moves the room from
// menace towards mourning, which is the difference between a place that wants
// to kill you and a place where things are kept.
//
//   npm run audio -- dungeon-prison
//   node public/assets/audio/dungeon-prison.js [out.wav]

const path = require('path');

const BAR = 4.0;                  // 4/4 at 60 BPM. Nothing here is in a hurry.
const BEAT = BAR / 4;
const BARS = 40;                  // five turns of the eight-bar ground
const LEN = BARS * BAR;           // 160 s exactly
const TAIL = 9;

const S = require('./synth')({ LEN, TAIL });
const { SR, N, NT, XFN: XF, mulberry32, mtof, loopq, smooth, pan2, svf, svfLP, svfState } = S;

const rnd = mulberry32(0xce115);

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

const { chain, breath, growl, pluck } = require('./voices')({ S, place, rnd });

// loop gain for a Karplus-Strong string that should lose 60 dB in t60 seconds
const dampFor = t60 => Math.exp(-6.9078 / (t60 * SR));

// ------------------------------------------------------------------- notes

const D1 = 26, A1 = 33, Bb1 = 34, C2 = 36, D2 = 38, E2 = 40, F2 = 41, G2 = 43,
      A2 = 45, Bb2 = 46, C3 = 48, D3 = 50, E3 = 52, F3 = 53, G3 = 55, A3 = 57,
      Bb3 = 58, C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67, A4 = 69,
      D5 = 74, F5 = 77, A5 = 81;

// D aeolian: D E F G A Bb C
const GROUND = [D2, C2, Bb1, A1, D2, C2, Bb1, A1];
const CHORDS = [
  [D3, F3, A3], [C3, E3, G3], [Bb2, D3, F3], [A2, C3, E3],
  [D3, F3, A3], [C3, E3, G3], [Bb2, D3, F3], [A2, C3, E3],
];

// ------------------------------------------------------------------ voices

// The ground bass, bowed. Long, heavy, and it never quite stops moving —
// three saws a hair apart, through a filter that opens as the bow digs in.
function lowBow(t, midi, dur, amp, panPos, send) {
  const start = Math.round(t * SR);
  if (start >= N || start < 0) return;
  const f = mtof(midi);
  const [l, r] = pan2(panPos);
  const total = Math.round(dur * SR);
  const atk = Math.round(0.28 * SR), rel = Math.round(0.9 * SR);
  const dets = [1, 1.0026, 0.9971];
  const phs = [rnd(), rnd(), rnd()];
  const st = svfState();
  for (let n = 0; n < total && start + n < NT; n++) {
    const t2 = n / SR;
    let saw = 0;
    for (let k = 0; k < 3; k++) {
      phs[k] += f * dets[k] / SR; if (phs[k] >= 1) phs[k] -= 1;
      saw += (2 * phs[k] - 1) * 0.33;
    }
    const e = n < atk ? smooth(n / atk)
            : n > total - rel ? smooth((total - n) / rel) : 1;
    const cut = 300 + 520 * smooth(t2 / 0.6) * Math.exp(-t2 / 2.2);
    place(start + n, svfLP(st, saw, cut, 0.95) * amp * e, l, r, send, 0.12);
  }
}

// The chord under it: strings held so long they stop sounding like an
// instrument and start sounding like the room being held shut.
function held(t, midis, dur, amp, send) {
  const start = Math.round(t * SR);
  if (start >= N || start < 0) return;
  const total = Math.round(dur * SR);
  const vs = midis.map((m, i) => ({
    f: mtof(m) * (1 + (rnd() - 0.5) * 0.004),
    ph: rnd(), ph2: rnd(),
    pan: (i / Math.max(1, midis.length - 1)) * 1.3 - 0.65,
    st: svfState(),
  }));
  const atk = total * 0.34, rel = total * 0.52;
  for (let n = 0; n < total && start + n < NT; n++) {
    const t2 = n / SR;
    const e = n < atk ? smooth(n / atk) : smooth((total - n) / rel);
    for (const v of vs) {
      v.ph += v.f / SR; if (v.ph >= 1) v.ph -= 1;
      v.ph2 += v.f * 1.0034 / SR; if (v.ph2 >= 1) v.ph2 -= 1;
      const saw = (2 * v.ph - 1) * 0.5 + (2 * v.ph2 - 1) * 0.5;
      const s = svfLP(v.st, saw, 620 + 260 * Math.sin(2 * Math.PI * t2 / 17), 1.0);
      const [l, r] = pan2(v.pan);
      place(start + n, s * amp * e * 0.6, l, r, send, 0.14);
    }
  }
}

// A struck iron bar. Free bar modes are wildly inharmonic — the second is
// nearly three times the first, not twice — which is why iron rings without
// ever sounding like a note you could sing.
const BAR_MODES = [[1, 1.00, 7.0], [2.76, 0.62, 3.4], [5.40, 0.30, 1.5],
                   [8.93, 0.15, 0.8], [13.34, 0.07, 0.4]];
function ironBar(t, midi, amp, panPos, send) {
  const start = Math.round(t * SR);
  if (start >= N || start < 0) return;
  const f0 = mtof(midi);
  const [l, r] = pan2(panPos);
  const dur = Math.round(9 * SR);
  // two copies a fraction apart, so it beats as it rings down
  const parts = BAR_MODES.map(([ratio, g, tau]) => ({
    w1: 2 * Math.PI * f0 * ratio / SR,
    w2: 2 * Math.PI * (f0 * ratio + 0.4 + rnd() * 1.1) / SR,
    ph: rnd() * 6.28, g, tau,
  }));
  const st = svfState();
  for (let n = 0; n < dur && start + n < NT; n++) {
    const t2 = n / SR;
    let s = 0;
    for (const p of parts) {
      s += (Math.sin(p.w1 * n + p.ph) + Math.sin(p.w2 * n)) * 0.5 * p.g * Math.exp(-t2 / p.tau);
    }
    const hit = svf(st, rnd() * 2 - 1, f0 * 6, 0.30) * Math.exp(-t2 / 0.010) * 0.7;
    place(start + n, (s * 0.4 + hit) * amp, l, r, send, 0.34);
  }
}

// The others. Not a moan you could put a face to — a vowel drifting through a
// throat, half a corridor away, and the pitch never settles where you expect.
const VOW = [[[380, 1.0], [860, 0.42], [2300, 0.07]],    // closed, "oo"
             [[620, 1.0], [1140, 0.50], [2450, 0.10]]];  // open, "uh"
function lament(t, midi, dur, amp, panPos, send) {
  const start = Math.round(t * SR);
  if (start >= N || start < 0) return;
  const f0 = mtof(midi);
  const [l, r] = pan2(panPos);
  const total = Math.round(dur * SR);
  const st = [svfState(), svfState(), svfState()];
  const trP = rnd() * 6.28, trR = 4.1 + rnd() * 1.8;
  let ph = 0, lp = 0;
  for (let n = 0; n < total && start + n < NT; n++) {
    const x = n / total, t2 = n / SR;
    // rises a little, then falls further than it rose
    // A real sigh bends, but not far. This used to sweep two and a half
    // semitones, which was inaudible against noise beds and badly out of tune
    // once they were gone: under a semitone now, so the voice stays in the key
    // while still falling further than it rose.
    const bend = 1 + 0.018 * Math.sin(Math.PI * Math.min(1, x * 1.5))
                   - 0.032 * smooth((x - 0.45) / 0.55);
    const tremble = 1 + 0.010 * Math.sin(2 * Math.PI * trR * t2 + trP) * smooth((x - 0.2) / 0.3);
    ph += f0 * bend * tremble / SR; if (ph >= 1) ph -= 1;
    let src = 2 * ph - 1;
    lp += 0.16 * (src - lp);
    src = lp + (rnd() * 2 - 1) * 0.07;
    // the vowel opens through the middle of the phrase and closes again
    const o = Math.sin(Math.PI * x);
    let out = 0;
    for (let k = 0; k < 3; k++) {
      const fc = VOW[0][k][0] + (VOW[1][k][0] - VOW[0][k][0]) * o;
      const g = VOW[0][k][1] + (VOW[1][k][1] - VOW[0][k][1]) * o;
      out += svf(st[k], src, fc, 0.17) * g;
    }
    const e = x < 0.25 ? smooth(x / 0.25) : smooth((1 - x) / 0.75);
    place(start + n, out * 0.5 * amp * e, l, r, send, 0.30);
  }
}

// A hurdy-gurdy drone. A wheel turns against the strings instead of a bow,
// so the pressure rises and falls once per revolution and the wheel is never
// quite round — that slow unevenness is the sound, and it is why this can hold
// a note for half a minute without going dead the way a synth pad does.
//
// It drones on D and A throughout, against harmony that moves underneath it.
// The friction when the chord reaches C or Bb is deliberate: a real gurdy
// cannot change its drone, and having to live with that is what gives the
// instrument its stubbornness.
function wheel(t, midi, dur, amp, panPos, send) {
  const start = Math.round(t * SR);
  if (start >= N || start < 0) return;
  const f = mtof(midi);
  const [l, r] = pan2(panPos);
  const total = Math.round(dur * SR);
  const atk = Math.round(2.2 * SR), rel = Math.round(3.4 * SR);
  // the drone string and its fifth, as a gurdy is actually strung
  const parts = [{ m: 1, g: 1.0 }, { m: 1.4983, g: 0.55 }, { m: 2, g: 0.30 }];
  const phs = parts.map(() => rnd());
  const st = svfState();
  const rev = 0.62 + rnd() * 0.16;          // revolutions per second
  const revP = rnd() * 6.28;
  for (let n = 0; n < total && start + n < NT; n++) {
    const t2 = n / SR;
    const turn = 2 * Math.PI * rev * t2 + revP;
    // pressure from the wheel: uneven, and with a second lump per turn
    const press = 0.72 + 0.20 * Math.sin(turn) + 0.08 * Math.sin(2 * turn + 1.1);
    let saw = 0;
    for (let k = 0; k < parts.length; k++) {
      phs[k] += f * parts[k].m / SR; if (phs[k] >= 1) phs[k] -= 1;
      saw += (2 * phs[k] - 1) * parts[k].g;
    }
    const e = n < atk ? smooth(n / atk)
            : n > total - rel ? smooth((total - n) / rel) : 1;
    const cut = 420 + 300 * press;
    place(start + n, svfLP(st, saw * 0.42, cut, 0.85) * amp * e * press, l, r, send, 0.10);
  }
}

// A struck bowl, left to ring. Almost harmonic but not quite, and every
// partial doubled a fraction away so the whole thing beats slowly against
// itself. This is what replaced the hiss in the top of the mix: something
// that shimmers because it is a real vibrating object, not because it is noise.
const BOWL = [[1, 1.00, 11.0], [2.013, 0.46, 7.0], [2.985, 0.24, 4.5], [4.07, 0.11, 2.6]];
function bowl(t, midi, dur, amp, panPos, send) {
  const start = Math.round(t * SR);
  if (start >= N || start < 0) return;
  const f0 = mtof(midi);
  const [l, r] = pan2(panPos);
  const total = Math.round(dur * SR);
  const parts = BOWL.map(([ratio, g, tau]) => ({
    w1: 2 * Math.PI * f0 * ratio / SR,
    w2: 2 * Math.PI * (f0 * ratio + 0.22 + rnd() * 0.5) / SR,
    ph: rnd() * 6.28, g, tau,
  }));
  const atk = Math.round(1.4 * SR);
  for (let n = 0; n < total && start + n < NT; n++) {
    const t2 = n / SR;
    let v = 0;
    for (const p of parts) {
      v += (Math.sin(p.w1 * n + p.ph) + Math.sin(p.w2 * n)) * 0.5 * p.g * Math.exp(-t2 / p.tau);
    }
    // rubbed rather than struck: no attack transient at all
    const e = n < atk ? smooth(n / atk) : 1;
    const out2 = n > total - SR ? (total - n) / SR : 1;
    place(start + n, v * 0.5 * amp * e * out2, l, r, send, 0.26);
  }
}

// A psaltery: metal strings over a box, plucked. Bright and short, and it
// takes over the job the torch crackle was doing badly — small points of
// light in the gaps, except now they are notes and they are in the key.
function psaltery(t, midi, amp, panPos, send) {
  pluck(t, midi, amp, panPos, send,
        { damp: dampFor(2.6), bright: 0.72, echo: 0.28, dur: 3.4 });
}

// -------------------------------------------------------------------- beds

function renderDrone(channelSeed) {
  const src = new Float32Array(N), dst = new Float32Array(N);
  const voices = [
    { midi: D1, amp: 0.34, det: 0.10 }, { midi: D1, amp: 0.31, det: -0.11 },
    { midi: A1, amp: 0.16, det: 0.06 },
    { midi: F2, amp: 0.085, det: -0.05 },   // the minor third, so the room is sad
    { midi: D2, amp: 0.12, det: 0.05 },
  ];
  for (const v of voices) {
    const f = loopq(mtof(v.midi) + v.det + channelSeed);
    const w = 2 * Math.PI * f / SR;
    const ph = rnd() * Math.PI * 2;
    for (let n = 0; n < N; n++) {
      const t = w * n + ph;
      src[n] += v.amp * (Math.sin(t) + 0.24 * Math.sin(2 * t) + 0.10 * Math.sin(3 * t));
    }
  }
  const lfo1 = 2 * Math.PI * loopq(1 / 37) / SR;
  const lfo3 = 2 * Math.PI * loopq(1 / 47) / SR;
  let lp = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let n = 0; n < N; n++) {
      const cut = 118 + 54 * Math.sin(lfo1 * n);
      lp += (1 - Math.exp(-2 * Math.PI * cut / SR)) * (src[n] - lp);
      if (pass) dst[n] = lp * (0.78 + 0.22 * Math.sin(lfo3 * n));
    }
  }
  return dst;
}

// --------------------------------------------------------------- the cycle

// Five turns of the ground, each doing something different, and the fifth
// coming back round to where the first started.
//   0-7   the cell alone, the bass and nothing else
//   8-15  the chord closes over it; the others start up
//  16-23  iron, chains, the fullest it gets
//  24-31  it empties out — the worst part is the quiet one
//  32-39  back up, then away, into the top of the loop
const TURN = [
  { at: 0,  bow: 0.85, held: 0,    iron: 0.25, lam: 0,    chain: 0.3, torch: 0.5 },
  { at: 8,  bow: 1.00, held: 0.70, iron: 0.55, lam: 0.55, chain: 0.7, torch: 0.8 },
  { at: 16, bow: 1.00, held: 1.00, iron: 1.00, lam: 0.90, chain: 1.0, torch: 1.0 },
  { at: 24, bow: 0.55, held: 0.30, iron: 0.30, lam: 0.75, chain: 0.4, torch: 0.35 },
  { at: 32, bow: 0.95, held: 0.80, iron: 0.75, lam: 0.60, chain: 0.8, torch: 0.7 },
];
const turnAt = bar => { let s = TURN[0]; for (const t of TURN) if (bar >= t.at) s = t; return s; };

const jit = () => (rnd() - 0.5) * 0.035;      // ambient; nothing is tight here

// --------------------------------------------------------------- the score

group = 'bow';
for (let bar = 0; bar < BARS; bar++) {
  const T = turnAt(bar);
  if (!T.bow) continue;
  lowBow(bar * BAR + jit(), GROUND[bar % 8], BAR * 0.92, 0.22 * T.bow, -0.12, 0.55);
  // the octave above, quietly, so the line is followable at all
  lowBow(bar * BAR + jit(), GROUND[bar % 8] + 12, BAR * 0.62, 0.060 * T.bow, 0.22, 0.62);
}

group = 'held';
for (let bar = 0; bar < BARS; bar += 2) {
  const T = turnAt(bar);
  if (!T.held) continue;
  held(bar * BAR + jit(), CHORDS[bar % 8], BAR * 2 * 0.94, 0.105 * T.held, 0.72);
}

// The iron speaks on the scale, but never on the beat and never in a pattern.
group = 'iron';
{
  const notes = [D3, F3, A3, C4, E3, D4, G3, F3, E3, C4, A3, G3];
  let t = 6.5, k = 0;
  while (t < LEN - 2) {
    const T = turnAt(Math.floor(t / BAR));
    if (T.iron > 0.2) {
      ironBar(t + jit(), notes[k % notes.length], 0.245 * T.iron * (0.7 + rnd() * 0.5),
              (rnd() * 2 - 1) * 0.8, 0.88);
      k++;
    }
    t += 4.5 + rnd() * 7.5;
  }
}

// The others, down the corridor. Loosely tracking the chord, so they are part
// of the harmony rather than sound effects laid over it.
group = 'lament';
{
  const pitches = [A2, D3, F3, C3, E3, Bb2, A2, G3, E3, C3, D3, G3];
  let t = 33, k = 0;
  while (t < LEN - 6) {
    const T = turnAt(Math.floor(t / BAR));
    if (T.lam > 0.2) {
      lament(t + jit(), pitches[k % pitches.length], 3.4 + rnd() * 3.2,
             0.225 * T.lam * (0.65 + rnd() * 0.6), (rnd() * 2 - 1) * 0.8, 0.86);
      k++;
    }
    t += 7 + rnd() * 11;
  }
}

group = 'chains';
{
  let t = 4;
  while (t < LEN - 4) {
    const T = turnAt(Math.floor(t / BAR));
    if (T.chain > 0.2) chain(t + jit(), 1.6 + rnd() * 2.6, 0.115 * T.chain, (rnd() * 2 - 1) * 0.85);
    t += 11 + rnd() * 16;
  }
}

// The gurdy, in long turns of the wheel, with gaps so it does not become
// wallpaper. It is the only thing here that runs continuously.
group = 'wheel';
wheel(2, D2, 30, 0.115, -0.45, 0.52);
wheel(6, A2, 26, 0.070, 0.50, 0.55);
wheel(40, D2, 34, 0.130, 0.38, 0.50);
wheel(46, A2, 28, 0.078, -0.42, 0.54);
wheel(96, D2, 24, 0.085, -0.30, 0.60);
wheel(126, D2, 32, 0.125, 0.34, 0.50);
wheel(132, A2, 26, 0.075, -0.38, 0.54);

group = 'bowl';
bowl(14, D5, 15, 0.085, 0.55, 0.80);
bowl(52, G4, 17, 0.075, -0.60, 0.82);
bowl(70, F5, 14, 0.068, 0.45, 0.84);
bowl(100, D5, 19, 0.090, -0.35, 0.86);
bowl(134, A4, 15, 0.072, 0.60, 0.82);
bowl(152, D5, 13, 0.060, -0.50, 0.84);

// Small points of light in the gaps, in the key rather than out of it.
group = 'psaltery';
{
  const notes = [D4, A3, F4, C4, E4, D4, G3, A3, C4, F3, D4, E4, A3, G3];
  let t = 9, k = 0;
  while (t < LEN - 3) {
    const T = turnAt(Math.floor(t / BAR));
    if (T.iron > 0.2) {
      psaltery(t + jit(), notes[k % notes.length],
               0.140 * (0.5 + T.iron * 0.6) * (0.6 + rnd() * 0.7),
               (rnd() * 2 - 1) * 0.75, 0.66);
      k++;
      // sometimes a second string, a beat behind
      if (rnd() < 0.35) psaltery(t + 0.9 + rnd() * 0.7, notes[(k + 3) % notes.length],
                                 0.078, (rnd() * 2 - 1) * 0.8, 0.70);
    }
    t += 3.2 + rnd() * 5.5;
  }
}

group = 'breath';
breath(28, 2, 4.4, 0.058, 0.5);
breath(99, 3, 4.8, 0.068, -0.4);
breath(150, 2, 4.2, 0.052, 0.35);

// Once, and a long way off. Whatever else they keep down here is not in a cell
// on this corridor.
group = 'growl';
growl(104, 6.5, 45, 0.36, 0.72, 0.88, 0.42);

// --------------------------------------------------------- corridor + room

const [ecL, ecR] = S.pingpong(echL, echR, 437, 661, 0.40, 0.52);
for (let n = 0; n < NT; n++) {
  dryL[n] += ecL[n] * 0.46; wetL[n] += ecL[n] * 0.68;
  dryR[n] += ecR[n] * 0.46; wetR[n] += ecR[n] * 0.68;
}

function shapeWet(x) {
  const kl = 1 - Math.exp(-2 * Math.PI * 4000 / SR);
  let lp = 0, hp = 0, prev = 0;
  for (let n = 0; n < x.length; n++) {
    lp += kl * (x[n] - lp);
    hp = 0.994 * (hp + lp - prev); prev = lp;
    x[n] = hp;
  }
}

const rvL = S.reverb(S.predelay(wetL, 29), [2953, 3343, 3767, 4159], [383, 179, 83], 4.6, 0.36);
const rvR = S.reverb(S.predelay(wetR, 34), [3037, 3433, 3853, 4253], [389, 191, 89], 4.6, 0.36);
shapeWet(rvL); shapeWet(rvR);

// ---------------------------------------------------------------- the mix

const outL = new Float32Array(NT), outR = new Float32Array(NT);
for (let n = 0; n < NT; n++) {
  outL[n] = dryL[n] * 0.60 + rvL[n] * 0.92;
  outR[n] = dryR[n] * 0.60 + rvR[n] * 0.92;
}

for (let n = 0; n < NT - N; n++) {
  outL[n] += outL[N + n];
  outR[n] += outR[N + n];
}

// No air bed, no rumble bed, no hiss. The drone is the only thing here that
// is not played, and the gurdy covers the continuous middle that the noise
// used to hold up.
if (on('beds')) {
  const droL = renderDrone(0.000), droR = renderDrone(0.023);
  for (let n = 0; n < N; n++) {
    const T = turnAt(Math.floor(n / SR / BAR));
    const g = 0.26 + 0.16 * T.bow;
    outL[n] += droL[n] * g;
    outR[n] += droR[n] * g;
  }
}

const loopL = outL.subarray(0, N), loopR = outR.subarray(0, N);
S.hpLoop(loopL, 26); S.hpLoop(loopL, 26);
S.hpLoop(loopR, 26); S.hpLoop(loopR, 26);

const { peak, gain } = S.master(outL, outR);

const gainFile = path.join(__dirname, '.mixgain-prison');
if (!SOLO) require('fs').writeFileSync(gainFile, String(gain));
const g2 = SOLO ? Number(require('fs').readFileSync(gainFile, 'utf8')) : gain;

// ------------------------------------------------------------- write wave

const outPath = process.argv[2] || path.join(__dirname, 'dungeon-prison.wav');
const bytes = S.writeWav(outPath, outL, outR, g2);

console.log(`${outPath}  ${LEN}s  ${BARS} bars, 5 turns of the ground  ${SR}Hz stereo  peak ${(peak * gain).toFixed(3)}  ${(bytes / 1048576).toFixed(1)} MB`);
