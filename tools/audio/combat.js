// combat.js — something has decided to fight you.
//
// The dungeon's key with a pulse in it. dungeon-crawl is D phrygian ambience;
// this is the same seven notes at 150 BPM with a low string ostinato driving
// underneath, war drums on top, and the creature from the depths turning up
// twice to remind you what you are swinging at.
//
// It loops as a fight loop should: no soft intro and no fade, because bar 79
// runs straight back into bar 0 and combat does not politely restart. The one
// thin passage is in the middle, where it belongs.
//
//   node tools/audio/combat.js [out.wav]

const path = require('path');

const BAR = 1.6;                     // 4/4 at 150 BPM
const E = BAR / 8;                   // eighth note, 0.2 s
const SX = BAR / 16;                 // sixteenth
const BARS = 80;
const LEN = BARS * BAR;              // 128 s exactly
const TAIL = 6;

const S = require('./synth')({ LEN, TAIL });
const { SR, N, NT, XFN: XF, mulberry32, mtof, loopq, smooth, pan2, svf, svfLP, svfState } = S;

const rnd = mulberry32(0xba771e);

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

const { growl } = require('./voices')({ S, place, rnd });

// ------------------------------------------------------------------- notes

const D1 = 26, D2 = 38, Eb2 = 39, F2 = 41, G2 = 43, A2 = 45, Bb2 = 46, C3 = 48,
      D3 = 50, Eb3 = 51, F3 = 53, G3 = 55, A3 = 57, Bb3 = 58, C4 = 60, D4 = 62,
      Eb4 = 63, F4 = 65, G4 = 67, A4 = 69, Bb4 = 70, C5 = 72, D5 = 74, Eb5 = 75,
      F5 = 77, A5 = 81;

// D phrygian: D Eb F G A Bb C — the dungeon's scale. The Eb a semitone above
// the tonic is the whole reason this sounds like a threat rather than a march.
const CH = {
  Dm: { root: D2, notes: [D3, F3, A3, D4] },
  Eb: { root: Eb2, notes: [Eb3, G3, Bb3, Eb4] },
  Bb: { root: Bb2, notes: [Bb2, D3, F3, Bb3] },
  C:  { root: C3, notes: [C3, Eb3, G3, C4] },
  Gm: { root: G2, notes: [G2, Bb2, D3, G3] },
};

const PROG_A = ['Dm', 'Dm', 'Bb', 'Bb', 'C', 'C', 'Dm', 'Dm'];
const PROG_B = ['Dm', 'Dm', 'Eb', 'Eb', 'Bb', 'Bb', 'C', 'C'];
const usesB = bar => bar >= 32 && bar < 56;
const chordAt = bar => CH[(usesB(bar) ? PROG_B : PROG_A)[bar % 8]];

// ------------------------------------------------------------------ voices

// Low strings, played short and hard. Three detuned saws through a filter that
// snaps open on the attack and closes again — that movement is most of what
// makes a synthesised string section read as bowed rather than as a pad.
function strings(t, midi, dur, amp, panPos, send, cutHi = 2800, cutLo = 780, atkMs = 9) {
  const start = Math.round(t * SR);
  if (start >= N || start < 0) return;
  const f = mtof(midi);
  const [l, r] = pan2(panPos);
  const total = Math.round(dur * SR);
  const atk = Math.round(atkMs * SR / 1000);
  const rel = Math.round(0.055 * SR);
  const dets = [1, 1.0037, 0.9962];
  const phs = [rnd(), rnd(), rnd()];
  const st = svfState();
  for (let n = 0; n < total && start + n < NT; n++) {
    const t2 = n / SR;
    let saw = 0;
    for (let k = 0; k < 3; k++) {
      phs[k] += f * dets[k] / SR; if (phs[k] >= 1) phs[k] -= 1;
      saw += (2 * phs[k] - 1) * 0.33;
    }
    const e = n < atk ? n / atk
            : n > total - rel ? Math.max(0, (total - n) / rel) : 1;
    // the filter follows the bow: open at the attack, settling as it holds
    const cut = cutLo + (cutHi - cutLo) * Math.exp(-t2 / 0.10);
    const v = svfLP(st, saw, Math.min(cut, 9000), 0.9);
    place(start + n, v * amp * e, l, r, send, 0);
  }
}

// Brass. Same idea, but slower to speak and with the filter opening rather
// than closing, so it swells into the note the way a horn section does.
function brass(t, midi, dur, amp, panPos, send) {
  const start = Math.round(t * SR);
  if (start >= N || start < 0) return;
  const f = mtof(midi);
  const [l, r] = pan2(panPos);
  const total = Math.round(dur * SR);
  const atk = Math.round(0.030 * SR), rel = Math.round(0.09 * SR);
  const dets = [1, 1.0028, 0.9974, 1.0009];
  const phs = [rnd(), rnd(), rnd(), rnd()];
  const st = svfState();
  const vibP = rnd() * 6.28;
  for (let n = 0; n < total && start + n < NT; n++) {
    const t2 = n / SR;
    const vib = 1 + 0.0022 * Math.sin(2 * Math.PI * 5.4 * t2 + vibP) * smooth((t2 - 0.12) / 0.3);
    let saw = 0;
    for (let k = 0; k < 4; k++) {
      phs[k] += f * dets[k] * vib / SR; if (phs[k] >= 1) phs[k] -= 1;
      saw += (2 * phs[k] - 1) * 0.25;
    }
    const e = n < atk ? smooth(n / atk)
            : n > total - rel ? smooth((total - n) / rel) : 1;
    const cut = 620 + 2900 * smooth(t2 / 0.11);
    const v = svfLP(st, saw, Math.min(cut, 8500), 0.9);
    place(start + n, v * amp * e, l, r, send, 0.12);
  }
}

// A big war drum. Skin, not a kick: the pitch drops fast and the body rings.
function taiko(t, amp, panPos) {
  const start = Math.round(t * SR);
  if (start >= N || start < 0) return;
  const [l, r] = pan2(panPos);
  const dur = Math.round(1.1 * SR);
  const st = svfState();
  let ph = 0, lp = 0;
  for (let n = 0; n < dur && start + n < NT; n++) {
    const t2 = n / SR;
    ph += 2 * Math.PI * (46 + 62 * Math.exp(-t2 / 0.030)) / SR;
    lp += 0.30 * ((rnd() * 2 - 1) - lp);
    const body = Math.sin(ph) * Math.exp(-t2 / 0.30);
    const skin = svf(st, rnd() * 2 - 1, 220, 0.60) * Math.exp(-t2 / 0.055) * 0.55;
    const stick = lp * Math.exp(-t2 / 0.008) * 0.40;
    place(start + n, (body + skin + stick) * amp, l, r, 0.32, 0.10);
  }
}

// The backbeat: a hard, dry mid drum. Wood and tension, no snare buzz.
function warDrum(t, amp, panPos) {
  const start = Math.round(t * SR);
  if (start >= N || start < 0) return;
  const [l, r] = pan2(panPos);
  const dur = Math.round(0.5 * SR);
  const st = svfState(), st2 = svfState();
  let ph = 0;
  for (let n = 0; n < dur && start + n < NT; n++) {
    const t2 = n / SR;
    ph += 2 * Math.PI * (168 + 90 * Math.exp(-t2 / 0.020)) / SR;
    const tone = Math.sin(ph) * Math.exp(-t2 / 0.085) * 0.6;
    const crack = svf(st, rnd() * 2 - 1, 1500, 0.50) * Math.exp(-t2 / 0.040)
                + svf(st2, rnd() * 2 - 1, 3800, 0.70) * Math.exp(-t2 / 0.016) * 0.5;
    place(start + n, (tone + crack * 0.75) * amp, l, r, 0.34, 0.08);
  }
}

// Rattle — rings on a belt, mail shifting. Keeps the sixteenths moving without
// anything as modern as a hi-hat.
function rattle(t, amp, panPos) {
  const start = Math.round(t * SR);
  if (start >= N || start < 0) return;
  const [l, r] = pan2(panPos);
  const dur = Math.round(0.06 * SR);
  const st = svfState();
  const fc = 3800 + rnd() * 3200;
  for (let n = 0; n < dur && start + n < NT; n++) {
    const v = svf(st, rnd() * 2 - 1, fc, 0.45);
    place(start + n, v * amp * Math.exp(-(n / SR) / 0.010), l, r, 0.40);
  }
}

// Struck metal for the top of a phrase — a shield, or a blade on a blade.
function clash(t, amp, panPos) {
  const start = Math.round(t * SR);
  if (start >= N || start < 0) return;
  const [l, r] = pan2(panPos);
  const dur = Math.round(3.2 * SR);
  const ratios = [1, 1.71, 2.46, 3.19, 4.28, 5.83, 7.44, 9.12];
  const base = 620 + rnd() * 180;
  const st = svfState();
  for (let n = 0; n < dur && start + n < NT; n++) {
    const t2 = n / SR;
    let s = 0;
    for (let k = 0; k < ratios.length; k++) {
      s += Math.sin(2 * Math.PI * base * ratios[k] * t2 + k)
         * Math.exp(-t2 / (1.9 / (1 + k * 0.55))) / (1 + k * 1.1);
    }
    const wash = svf(st, rnd() * 2 - 1, 5200, 0.8) * Math.exp(-t2 / 0.09) * 0.5;
    place(start + n, (s * 0.5 + wash) * amp, l, r, 0.72, 0.20);
  }
}

// High strings, tremolo. A cluster shaking in the top of the mix — the sound
// of not being able to see where the next one is coming from.
function tremolo(t, midis, dur, amp, send) {
  const start = Math.round(t * SR);
  if (start >= N || start < 0) return;
  const total = Math.round(dur * SR);
  const voices = midis.map((m, i) => ({
    f: mtof(m) * (1 + (rnd() - 0.5) * 0.006),
    ph: rnd(),
    pan: (i / Math.max(1, midis.length - 1)) * 1.5 - 0.75,
    st: svfState(),
    tr: 13 + rnd() * 4,          // bow strokes per second
    trP: rnd() * 6.28,
  }));
  const atk = total * 0.22, rel = total * 0.35;
  for (let n = 0; n < total && start + n < NT; n++) {
    const t2 = n / SR;
    const e = n < atk ? smooth(n / atk) : smooth((total - n) / rel);
    for (const v of voices) {
      v.ph += v.f / SR; if (v.ph >= 1) v.ph -= 1;
      const saw = 2 * v.ph - 1;
      const bow = 0.45 + 0.55 * Math.abs(Math.sin(Math.PI * v.tr * t2 + v.trP));
      const s = svfLP(v.st, saw, v.f * 3.4, 0.9) * bow;
      const [l, r] = pan2(v.pan);
      place(start + n, s * amp * e * 0.5, l, r, send, 0.10);
    }
  }
}

// Sub weight under the accents. Felt, not heard.
function sub(t, midi, dur, amp) {
  const start = Math.round(t * SR);
  if (start >= N || start < 0) return;
  const f = mtof(midi);
  const total = Math.round(dur * SR);
  for (let n = 0; n < total && start + n < NT; n++) {
    const t2 = n / SR;
    const e = (1 - Math.exp(-t2 / 0.008)) * Math.exp(-t2 / (dur * 0.42));
    place(start + n, Math.sin(2 * Math.PI * f * t2) * amp * e, 0.707, 0.707, 0.15);
  }
}

// -------------------------------------------------------------------- tune

// Four bars, angular, and it keeps falling back onto the tonic from a
// semitone above. [eighth, midi, length in eighths]
const MOTIF = [
  [0, D4, 2], [2, Eb4, 1], [3, D4, 1], [4, C4, 2], [6, D4, 2],
  [8, A4, 4], [12, G4, 2], [14, F4, 2],
  [16, F4, 2], [18, Eb4, 1], [19, D4, 1], [20, C4, 2], [22, Bb3, 2],
  [24, D4, 6], [30, Eb4, 2],
];

// ------------------------------------------------------------------- score

// The ostinato: which chord tone on each eighth, and how hard. The accents
// fall 1 - and-of-2 - 4, which is what stops it marching.
const OST_NOTE = [0, 0, 2, 0, 0, 2, 0, 1];
const OST_GAIN = [1.0, 0.5, 0.78, 0.52, 0.9, 0.55, 0.72, 0.62];

const SECTIONS = [
  { at: 0,  ost: 0.95, drum: 0.9,  rat: 0.5, brass: 0.55, trem: 0,    sub: 0.9, mel: null },
  { at: 8,  ost: 0.9,  drum: 0.8,  rat: 0.4, brass: 0,    trem: 0,    sub: 0.8, mel: null },
  { at: 16, ost: 1.0,  drum: 0.95, rat: 0.6, brass: 0.6,  trem: 0.3,  sub: 0.9, mel: MOTIF },
  { at: 24, ost: 0.95, drum: 0.9,  rat: 0.55, brass: 0.4, trem: 0.25, sub: 0.85, mel: null },
  { at: 32, ost: 0.3,  drum: 0.18, rat: 0,   brass: 0,    trem: 0.75, sub: 0.2, mel: null },
  { at: 40, ost: 0.85, drum: 0.7,  rat: 0.45, brass: 0.5, trem: 0.4,  sub: 0.75, mel: MOTIF },
  { at: 48, ost: 0.95, drum: 0.9,  rat: 0.6, brass: 0.7,  trem: 0.45, sub: 0.9, mel: null },
  { at: 56, ost: 1.0,  drum: 1.0,  rat: 0.7, brass: 0.9,  trem: 0.5,  sub: 1.0, mel: MOTIF },
  { at: 64, ost: 1.0,  drum: 1.0,  rat: 0.75, brass: 1.0, trem: 0.55, sub: 1.0, mel: MOTIF, oct: 12 },
  { at: 72, ost: 0.95, drum: 0.95, rat: 0.65, brass: 0.6, trem: 0.35, sub: 0.9, mel: null },
];
const sectionAt = bar => {
  let s = SECTIONS[0];
  for (const c of SECTIONS) if (bar >= c.at) s = c;
  return s;
};

// Combat is tight. A third of the town's jitter, and much less of it.
const jit = () => (rnd() - 0.5) * 0.006;
const vary = (d = 0.10) => 1 - d * rnd();

group = 'strings';
for (let bar = 0; bar < BARS; bar++) {
  const sec = sectionAt(bar), ch = chordAt(bar);
  if (!sec.ost) continue;
  for (let i = 0; i < 8; i++) {
    const t = bar * BAR + i * E + jit();
    // the last eighth of every second bar steps up to the note above, which
    // is the Eb whenever we are on D
    const idx = (i === 7 && bar % 2 === 1) ? 1 : OST_NOTE[i];
    const midi = ch.root + [0, 1, 7, 12][idx === 1 ? 1 : idx === 2 ? 2 : 0];
    strings(t, midi, E * 0.92, 0.19 * sec.ost * OST_GAIN[i] * vary(),
            -0.2 + (i % 2) * 0.4, 0.22, 2600, 720);
    // doubled an octave up, quieter, for definition
    strings(t, midi + 12, E * 0.86, 0.085 * sec.ost * OST_GAIN[i] * vary(),
            0.15, 0.26, 4200, 1500);
  }
}

group = 'drums';
for (let bar = 0; bar < BARS; bar++) {
  const sec = sectionAt(bar);
  if (!sec.drum) continue;
  const b = bar * BAR;
  taiko(b + jit(), 0.42 * sec.drum * vary(0.08), -0.12);
  taiko(b + 4 * E + jit(), 0.31 * sec.drum * vary(0.12), -0.08);
  if (bar % 2 === 1) taiko(b + 7 * E + jit(), 0.23 * sec.drum * vary(0.15), -0.18);
  warDrum(b + 2 * E + jit(), 0.52 * sec.drum * vary(0.08), 0.18);
  warDrum(b + 6 * E + jit(), 0.54 * sec.drum * vary(0.08), 0.20);
  // a fill in the last bar of every eight, driving into the next phrase
  if (bar % 8 === 7 && sec.drum > 0.5) {
    for (const s16 of [10, 11, 12, 13, 14, 15]) {
      warDrum(b + s16 * SX + jit(), 0.20 * sec.drum * (0.55 + s16 / 22), 0.1 - (s16 % 3) * 0.2);
    }
  }
}

group = 'rattle';
for (let bar = 0; bar < BARS; bar++) {
  const sec = sectionAt(bar);
  if (!sec.rat) continue;
  for (let i = 0; i < 16; i++) {
    if (i % 2 === 0 && rnd() < 0.25) continue;      // not machine-perfect
    rattle(bar * BAR + i * SX + jit(), 0.32 * sec.rat * (i % 4 === 0 ? 1 : 0.6) * vary(0.3),
           (rnd() - 0.5) * 1.2);
  }
}

group = 'brass';
for (let bar = 0; bar < BARS; bar++) {
  const sec = sectionAt(bar), ch = chordAt(bar);
  if (!sec.brass) continue;
  // stabs on the downbeat and the and-of-three
  for (const [e8, g, len] of [[0, 1.0, 1.6], [5, 0.7, 0.9]]) {
    if (e8 === 5 && bar % 2 === 0) continue;
    ch.notes.forEach((m, k) => {
      brass(bar * BAR + e8 * E + jit(), m, E * len, 0.135 * sec.brass * g * vary(),
            (k / 3) * 1.2 - 0.6, 0.30);
    });
  }
}

group = 'melody';
for (const sec of SECTIONS) {
  if (!sec.mel) continue;
  const oct = sec.oct || 0;
  for (const [e8, midi, len] of sec.mel) {
    brass(sec.at * BAR + e8 * E + jit(), midi + oct, len * E * 0.94,
          0.145 * vary(0.08), (rnd() - 0.5) * 0.3, 0.34);
  }
}

group = 'tremolo';
for (const sec of SECTIONS) {
  if (!sec.trem) continue;
  const ch = chordAt(sec.at);
  const top = [ch.notes[0] + 24, ch.notes[1] + 24, ch.notes[0] + 25];   // with the semitone
  tremolo(sec.at * BAR, top, 8 * BAR * 0.96, 0.075 * sec.trem, 0.55);
}

group = 'sub';
for (let bar = 0; bar < BARS; bar++) {
  const sec = sectionAt(bar), ch = chordAt(bar);
  if (!sec.sub) continue;
  sub(bar * BAR + jit(), ch.root - 12, 0.55, 0.34 * sec.sub);
  if (bar % 2 === 1) sub(bar * BAR + 4 * E + jit(), ch.root - 12, 0.32, 0.19 * sec.sub);
}

group = 'metal';
for (const bar of [0, 16, 32, 40, 56, 64, 72]) {
  clash(bar * BAR + jit(), bar === 56 || bar === 64 ? 0.115 : 0.085, (rnd() - 0.5) * 0.9);
}

// The thing from the depths, twice: once alone in the thin passage, once in
// the middle of the loudest bar of the fight.
group = 'growl';
growl(32 * BAR + 1.2, 5.0, 48, 0.66, -0.25, 0.50, 0.20);
growl(36 * BAR + 0.4, 4.0, 41, 0.60, 0.30, 0.54, 0.22);
growl(64 * BAR + 2.4, 3.5, 44, 0.82, -0.10, 0.34, 0.14);

// --------------------------------------------------------- echo + the room

// An eighth and a dotted eighth, so repeats reinforce the groove.
const [ecL, ecR] = S.pingpong(echL, echR, E * 1000, E * 1500, 0.26, 0.45);
for (let n = 0; n < NT; n++) {
  dryL[n] += ecL[n] * 0.30; wetL[n] += ecL[n] * 0.42;
  dryR[n] += ecR[n] * 0.30; wetR[n] += ecR[n] * 0.42;
}

// A hall, but a controlled one. At this tempo a long tail turns the ostinato
// to porridge, so it is short and rolled off early.
function shapeWet(x) {
  const kl = 1 - Math.exp(-2 * Math.PI * 4600 / SR);
  let lp = 0, hp = 0, prev = 0;
  for (let n = 0; n < x.length; n++) {
    lp += kl * (x[n] - lp);
    hp = 0.9935 * (hp + lp - prev); prev = lp;
    x[n] = hp;
  }
}

const rvL = S.reverb(S.predelay(wetL, 18), [1801, 2069, 2311, 2593], [271, 113, 53], 1.9, 0.34);
const rvR = S.reverb(S.predelay(wetR, 22), [1847, 2113, 2371, 2647], [277, 127, 59], 1.9, 0.34);
shapeWet(rvL); shapeWet(rvR);

// ---------------------------------------------------------------- the mix

const outL = new Float32Array(NT), outR = new Float32Array(NT);
for (let n = 0; n < NT; n++) {
  outL[n] = dryL[n] * 0.80 + rvL[n] * 0.40;
  outR[n] = dryR[n] * 0.80 + rvR[n] * 0.40;
}

for (let n = 0; n < NT - N; n++) {
  outL[n] += outL[N + n];
  outR[n] += outR[N + n];
}

const loopL = outL.subarray(0, N), loopR = outR.subarray(0, N);
S.hpLoop(loopL, 28); S.hpLoop(loopL, 28);
S.hpLoop(loopR, 28); S.hpLoop(loopR, 28);

// Driven a little harder than the other four: this one should sound like it is
// being pushed.
const { peak, gain } = S.master(outL, outR, 0.89, 1.35);

const gainFile = path.join(__dirname, '.mixgain-combat');
if (!SOLO) require('fs').writeFileSync(gainFile, String(gain));
const g2 = SOLO ? Number(require('fs').readFileSync(gainFile, 'utf8')) : gain;

// ------------------------------------------------------------- write wave

const outPath = process.argv[2] || path.join(__dirname, 'combat.wav');
const bytes = S.writeWav(outPath, outL, outR, g2);

console.log(`${outPath}  ${LEN}s  ${BARS} bars @150BPM  ${SR}Hz stereo  peak ${(peak * gain).toFixed(3)}  ${(bytes / 1048576).toFixed(1)} MB`);
