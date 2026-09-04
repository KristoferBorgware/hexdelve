// town.js — the town, in daylight. Nothing is hunting you here.
//
// The first piece in this set with a pulse. Where the dungeon tracks are
// ambience with events scattered over them, this one has a tempo, a chord
// progression and a tune: a lute rolling a 6/8 arpeggio, a plucked bass, a
// soft frame drum, and a wooden flute over the top.
//
// It is in D — the same tonic as dungeon-crawl, which is in D phrygian. Same
// world, lit differently: the dungeon leans on the flat second, the town on
// the natural third and the flat seventh, so the two share a root but not a
// mood.
//
//   npm run audio -- town
//   node public/assets/audio/town.js [out.wav]

const path = require('path');

// 6/8 at a walking pace. The loop is a whole number of bars, which is what
// lets the music meet itself at the splice.
const BAR = 1.05;                    // seconds per bar
const E = BAR / 6;                   // one eighth note
const BARS = 120;
const LEN = BARS * BAR;              // 126 s exactly
const TAIL = 6;

const S = require('./synth')({ LEN, TAIL });
const { SR, N, NT, XFN: XF, mulberry32, mtof, loopq, smooth, pan2, svf, svfState } = S;

const rnd = mulberry32(0x7a1e5);

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

const { pluck } = require('./voices')({ S, place, rnd });

// A Karplus-Strong string loses 60 dB in `t60` seconds when the loop gain is
// this — and it comes out independent of pitch, because a lower note goes
// round its longer buffer proportionally less often.
const dampFor = t60 => Math.exp(-6.9078 / (t60 * SR));

// ------------------------------------------------------------------- notes

const A1 = 33, C2 = 36, D2 = 38, G2 = 43, A2 = 45, B2 = 47, C3 = 48, D3 = 50,
      E3 = 52, Fs3 = 54, G3 = 55, A3 = 57, B3 = 59, C4 = 60, D4 = 62, E4 = 64,
      Fs4 = 66, G4 = 67, A4 = 69, B4 = 71, C5 = 72, D5 = 74, Fs5 = 78, A5 = 81;

// D mixolydian: D E F# G A B C. The C natural is what keeps it folk rather
// than fanfare — there is no leading note pulling anywhere.
const CH = {
  D:  { bass: D2, notes: [D3, Fs3, A3, D4] },
  C:  { bass: C2, notes: [C3, E3, G3, C4] },
  G:  { bass: G2, notes: [B2, D3, G3, B3] },
  Bm: { bass: B2, notes: [B2, D3, Fs3, B3] },
  Am: { bass: A2, notes: [A2, C3, E3, A3] },
};

const PROG_A = ['D', 'C', 'G', 'D', 'D', 'C', 'G', 'D'];
const PROG_B = ['Bm', 'G', 'D', 'Am', 'Bm', 'G', 'C', 'D'];
const usesB = bar => (bar >= 40 && bar < 56) || (bar >= 80 && bar < 96);
const chordAt = bar => CH[(usesB(bar) ? PROG_B : PROG_A)[bar % 8]];

// ------------------------------------------------------------------ voices

// A lute. The same plucked string as the dungeon, but ringing for a second and
// a half instead of a tenth of one, and picked much brighter.
function lute(t, midi, amp, panPos, t60 = 1.5) {
  pluck(t, midi, amp, panPos, 0.34,
        { damp: dampFor(t60), bright: 0.55, echo: 0.10, dur: t60 * 1.4 });
}

function bassNote(t, midi, amp) {
  pluck(t, midi, amp, 0, 0.22,
        { damp: dampFor(1.8), bright: 0.16, echo: 0, dur: 2.2 });
}

// A wooden flute: mostly fundamental, a little breath, and vibrato that only
// arrives once the note has been held a moment — the way a player does it.
function flute(t, midi, dur, amp, panPos, send) {
  const start = Math.round(t * SR);
  if (start >= N || start < 0) return;
  const f = mtof(midi);
  const [l, r] = pan2(panPos);
  const total = Math.round(dur * SR);
  const atk = Math.round(0.045 * SR), rel = Math.round(0.11 * SR);
  const st = svfState();
  const vibP = rnd() * 6.28;
  let ph = 0;
  for (let n = 0; n < total && start + n < NT; n++) {
    const t2 = n / SR;
    const vibDepth = 0.0035 * smooth((t2 - 0.18) / 0.35);   // delayed vibrato
    const ff = f * (1 + vibDepth * Math.sin(2 * Math.PI * 5.2 * t2 + vibP));
    ph += 2 * Math.PI * ff / SR;
    const tone = Math.sin(ph) + 0.22 * Math.sin(2 * ph) + 0.10 * Math.sin(3 * ph)
               + 0.04 * Math.sin(4 * ph);
    // breath, with a stronger puff as the note speaks
    const air = svf(st, rnd() * 2 - 1, 2600, 0.55)
              * (0.05 + 0.16 * Math.exp(-t2 / 0.05));
    const e = n < atk ? smooth(n / atk)
            : n > total - rel ? smooth((total - n) / rel) : 1;
    place(start + n, (tone * 0.5 + air) * amp * e, l, r, send, 0.22);
  }
}

// A frame drum played with the hand: a low open stroke and a light rim tap.
// Nothing martial — this is somebody keeping time on a doorstep.
function drum(t, kind, amp, panPos) {
  const start = Math.round(t * SR);
  if (start >= N || start < 0) return;
  const [l, r] = pan2(panPos);
  const dur = Math.round(0.5 * SR);
  const st = svfState();
  let ph = 0, lp = 0;
  for (let n = 0; n < dur && start + n < NT; n++) {
    const t2 = n / SR;
    let v;
    if (kind === 'dum') {
      ph += 2 * Math.PI * (58 + 52 * Math.exp(-t2 / 0.035)) / SR;
      lp += 0.25 * ((rnd() * 2 - 1) - lp);
      v = Math.sin(ph) * Math.exp(-t2 / 0.19) + lp * Math.exp(-t2 / 0.018) * 0.30;
    } else {
      v = svf(st, rnd() * 2 - 1, 2200, 0.45) * Math.exp(-t2 / 0.028)
        + Math.sin(2 * Math.PI * 520 * t2) * Math.exp(-t2 / 0.020) * 0.25;
    }
    place(start + n, v * amp, l, r, 0.30);
  }
}

// A small struck bell, for the odd bit of light on a section change.
function chime(t, midi, amp, panPos) {
  const start = Math.round(t * SR);
  if (start >= N || start < 0) return;
  const f = mtof(midi);
  const [l, r] = pan2(panPos);
  const parts = [[1, 1.00, 2.2], [2.74, 0.48, 1.1], [5.38, 0.22, 0.55], [8.93, 0.10, 0.30]];
  const dur = Math.round(3 * SR);
  for (let n = 0; n < dur && start + n < NT; n++) {
    const t2 = n / SR;
    let v = 0;
    for (const [ratio, g, tau] of parts) {
      v += Math.sin(2 * Math.PI * f * ratio * t2) * g * Math.exp(-t2 / tau);
    }
    place(start + n, v * 0.28 * amp * (1 - Math.exp(-t2 / 0.003)), l, r, 0.55, 0.30);
  }
}

// ------------------------------------------------------------------- tunes

// [eighth, midi, length in eighths]
const MEL_A = [
  [0, A3, 1], [1, D4, 2], [3, Fs4, 3],
  [6, E4, 3], [9, D4, 3],
  [12, E4, 1], [13, G4, 2], [15, E4, 3],
  [18, D4, 3], [21, B3, 3],
  [24, A3, 1], [25, D4, 2], [27, Fs4, 3],
  [30, A4, 3], [33, G4, 3],
  [36, Fs4, 2], [38, E4, 1], [39, D4, 3],
  [42, D4, 6],
];
const MEL_B = [
  [0, Fs4, 3], [3, D4, 3],
  [6, G4, 3], [9, B4, 3],
  [12, A4, 2], [14, Fs4, 1], [15, D4, 3],
  [18, E4, 3], [21, C4, 3],
  [24, D4, 3], [27, Fs4, 3],
  [30, B4, 3], [33, A4, 3],
  [36, G4, 3], [39, E4, 3],
  [42, D4, 6],
];
// the interlude: four long notes over eight bars, and room to breathe
const MEL_QUIET = [[0, A3, 9], [12, D4, 9], [24, Fs4, 9], [36, E4, 10]];

// --------------------------------------------------------------- the score

// arp: which of the four chord tones is picked on each eighth of the bar
const ARP = [0, 2, 3, 1, 2, 3];

const SECTIONS = [
  { at: 0,   arp: 0.50, bass: 0,    drum: 0,    mel: null,     flute: 0 },
  { at: 8,   arp: 0.80, bass: 0.85, drum: 0.50, mel: null,     flute: 0 },
  { at: 24,  arp: 0.80, bass: 0.85, drum: 0.60, mel: MEL_A,    flute: 0.30 },
  { at: 40,  arp: 0.85, bass: 0.90, drum: 0.70, mel: MEL_B,    flute: 0.32 },
  { at: 56,  arp: 0.55, bass: 0.40, drum: 0,    mel: MEL_QUIET, flute: 0.20 },
  { at: 64,  arp: 0.85, bass: 0.90, drum: 0.65, mel: MEL_A,    flute: 0.30 },
  { at: 72,  arp: 0.90, bass: 0.95, drum: 0.70, mel: MEL_A,    flute: 0.26, oct: 12 },
  { at: 80,  arp: 0.95, bass: 1.00, drum: 0.80, mel: MEL_B,    flute: 0.34 },
  { at: 96,  arp: 0.80, bass: 0.85, drum: 0.55, mel: MEL_A,    flute: 0.28 },
  { at: 104, arp: 0.65, bass: 0.65, drum: 0.25, mel: null,     flute: 0 },
  { at: 112, arp: 0.45, bass: 0.30, drum: 0,    mel: null,     flute: 0 },
];
const sectionAt = bar => {
  let s = SECTIONS[0];
  for (const c of SECTIONS) if (bar >= c.at) s = c;
  return s;
};

// Nothing here lands exactly on the grid. A few milliseconds either way and a
// little variation in weight is the whole difference between a band and a
// sequencer.
const human = () => (rnd() - 0.5) * 0.016;
const vary = (d = 0.18) => 1 - d * rnd();

group = 'lute';
for (let bar = 0; bar < BARS; bar++) {
  const sec = sectionAt(bar), ch = chordAt(bar);
  if (!sec.arp) continue;
  for (let i = 0; i < 6; i++) {
    const t = bar * BAR + i * E + human();
    const midi = ch.notes[ARP[i]];
    // the first of each group of three carries the beat
    const accent = i % 3 === 0 ? 1.0 : 0.72;
    lute(t, midi, 0.145 * sec.arp * accent * vary(), (rnd() - 0.5) * 0.5);
  }
  // an octave sparkle on the downbeat of every other bar
  if (bar % 4 === 0 && sec.arp > 0.6) {
    lute(bar * BAR + human(), ch.notes[3] + 12, 0.055 * sec.arp * vary(), 0.35, 1.1);
  }
}

group = 'bass';
for (let bar = 0; bar < BARS; bar++) {
  const sec = sectionAt(bar), ch = chordAt(bar);
  if (!sec.bass) continue;
  bassNote(bar * BAR + human(), ch.bass, 0.135 * sec.bass * vary(0.12));
  bassNote(bar * BAR + 3 * E + human(), ch.bass + (bar % 2 ? 7 : 12), 0.085 * sec.bass * vary(0.2));
}

group = 'drum';
for (let bar = 0; bar < BARS; bar++) {
  const sec = sectionAt(bar);
  if (!sec.drum) continue;
  const b = bar * BAR;
  drum(b + human(), 'dum', 0.62 * sec.drum * vary(0.12), -0.15);
  drum(b + 2 * E + human(), 'tek', 0.30 * sec.drum * vary(0.3), 0.32);
  drum(b + 3 * E + human(), 'dum', 0.38 * sec.drum * vary(0.2), -0.10);
  drum(b + 5 * E + human(), 'tek', 0.27 * sec.drum * vary(0.3), 0.28);
  if (bar % 8 === 7) drum(b + 4 * E + human(), 'tek', 0.26 * sec.drum, 0.4);  // a turnaround
}

group = 'flute';
for (const sec of SECTIONS) {
  if (!sec.mel) continue;
  const oct = sec.oct || 0;
  for (const [e8, midi, len] of sec.mel) {
    const t = sec.at * BAR + e8 * E + human();
    // clip the note slightly so consecutive notes articulate
    flute(t, midi + oct, len * E * 0.92, 0.235 * sec.flute / 0.30 * vary(0.12),
          (rnd() - 0.5) * 0.35, 0.42);
  }
}

group = 'chime';
for (const bar of [40, 64, 80, 96]) {
  const ch = chordAt(bar);
  chime(bar * BAR, ch.notes[2] + 12, 0.40, 0.45);
  chime(bar * BAR + 3 * E, ch.notes[3] + 12, 0.27, -0.4);
}

// -------------------------------------------------------------------- beds

// A quiet warm pad on the tonic, and a breath of open air. Both are almost
// under the threshold — they are here so the gaps between phrases are not
// digital silence.
function renderPad(channelSeed) {
  const src = new Float32Array(N), dst = new Float32Array(N);
  const voices = [
    { midi: D2, amp: 0.30, det: 0.07 }, { midi: D2, amp: 0.27, det: -0.09 },
    { midi: A2, amp: 0.15, det: 0.05 }, { midi: D3, amp: 0.11, det: -0.06 },
    { midi: Fs4, amp: 0.030, det: 0.04 },
  ];
  for (const v of voices) {
    const f = loopq(mtof(v.midi) + v.det + channelSeed);
    const w = 2 * Math.PI * f / SR;
    const ph = rnd() * Math.PI * 2;
    for (let n = 0; n < N; n++) {
      const t = w * n + ph;
      src[n] += v.amp * (Math.sin(t) + 0.18 * Math.sin(2 * t) + 0.07 * Math.sin(3 * t));
    }
  }
  const lfo1 = 2 * Math.PI * loopq(1 / 21) / SR;
  const lfo3 = 2 * Math.PI * loopq(1 / 31) / SR;
  let lp = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let n = 0; n < N; n++) {
      const cut = 380 + 150 * Math.sin(lfo1 * n);
      lp += (1 - Math.exp(-2 * Math.PI * cut / SR)) * (src[n] - lp);
      if (pass) dst[n] = lp * (0.82 + 0.18 * Math.sin(lfo3 * n));
    }
  }
  return dst;
}

function renderOpenAir(seed) {
  const r = mulberry32(seed);
  const M = N + XF;
  const buf = new Float32Array(M);
  let hp = 0, prev = 0, lp = 0;
  for (let n = 0; n < M; n++) {
    const w = r() * 2 - 1;
    hp = 0.90 * (hp + w - prev); prev = w;
    lp += 0.22 * (hp - lp);
    const t = n / SR;
    buf[n] = lp * (0.6 + 0.4 * Math.sin(2 * Math.PI * t / 13 + seed));
  }
  return S.crossfadeLoop(buf);
}

// --------------------------------------------------------- echo + the room

// Delays set to two and three eighths, so the repeats fall on the beat
// instead of blurring it.
const [ecL, ecR] = S.pingpong(echL, echR, E * 2000, E * 3000, 0.28, 0.42);
for (let n = 0; n < NT; n++) {
  dryL[n] += ecL[n] * 0.34; wetL[n] += ecL[n] * 0.40;
  dryR[n] += ecR[n] * 0.34; wetR[n] += ecR[n] * 0.40;
}

// A small bright room — a square with buildings round it, not a cavern. A
// third of the dungeon's decay, and much less of it in the mix.
function shapeWet(x) {
  const kl = 1 - Math.exp(-2 * Math.PI * 6500 / SR);
  let lp = 0, hp = 0, prev = 0;
  for (let n = 0; n < x.length; n++) {
    lp += kl * (x[n] - lp);
    hp = 0.992 * (hp + lp - prev); prev = lp;
    x[n] = hp;
  }
}

const rvL = S.reverb(S.predelay(wetL, 16), [1481, 1693, 1871, 2053], [223, 97, 43], 1.6, 0.22);
const rvR = S.reverb(S.predelay(wetR, 19), [1523, 1741, 1913, 2099], [229, 101, 47], 1.6, 0.22);
shapeWet(rvL); shapeWet(rvR);

// ---------------------------------------------------------------- the mix

const outL = new Float32Array(NT), outR = new Float32Array(NT);
for (let n = 0; n < NT; n++) {
  outL[n] = dryL[n] * 0.74 + rvL[n] * 0.46;
  outR[n] = dryR[n] * 0.74 + rvR[n] * 0.46;
}

// fold the tail back over the head so the loop is seamless
for (let n = 0; n < NT - N; n++) {
  outL[n] += outL[N + n];
  outR[n] += outR[N + n];
}

if (on('beds')) {
  const padL = renderPad(0.000), padR = renderPad(0.019);
  const airL = renderOpenAir(4242), airR = renderOpenAir(1717);
  for (let n = 0; n < N; n++) {
    outL[n] += padL[n] * 0.055 + airL[n] * 0.020;
    outR[n] += padR[n] * 0.055 + airR[n] * 0.020;
  }
}

const loopL = outL.subarray(0, N), loopR = outR.subarray(0, N);
S.hpLoop(loopL, 30); S.hpLoop(loopL, 30);
S.hpLoop(loopR, 30); S.hpLoop(loopR, 30);

const { peak, gain } = S.master(outL, outR);

const gainFile = path.join(__dirname, '.mixgain-town');
if (!SOLO) require('fs').writeFileSync(gainFile, String(gain));
const g2 = SOLO ? Number(require('fs').readFileSync(gainFile, 'utf8')) : gain;

// ------------------------------------------------------------- write wave

const outPath = process.argv[2] || path.join(__dirname, 'town.wav');
const bytes = S.writeWav(outPath, outL, outR, g2);

console.log(`${outPath}  ${LEN}s  ${BARS} bars  ${SR}Hz stereo  peak ${(peak * gain).toFixed(3)}  ${(bytes / 1048576).toFixed(1)} MB`);
