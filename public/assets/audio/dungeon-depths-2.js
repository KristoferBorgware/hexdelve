// dungeon-depths-2.js — the same depths, but you have found what was built here.
//
// A flooded crypt cut into the cave: water everywhere, almost no moving air,
// and three gothic voices where the guitar used to be — a pipe organ, a tolling
// bell, and a low male choir. The creature is still down here.
//
//   npm run audio -- dungeon-depths-2
//   node public/assets/audio/dungeon-depths-2.js [out.wav]

const path = require('path');

const LEN = 180;
const TAIL = 9;
const S = require('./synth')({ LEN, TAIL });
const { SR, N, NT, XFN: XF, mulberry32, mtof, loopq, smooth, pan2, svf, svfState } = S;

const rnd = mulberry32(0xc0ffee);

// C phrygian: C Db Eb F G Ab Bb. The Db against C is the rub, Gb is the
// tritone, and C-Eb-G gives the organ and the choir something to be minor in.
const C1 = 24, Db1 = 25, G1 = 31, C2 = 36, Db2 = 37, Eb2 = 39, Gb2 = 42, G2 = 43,
      Ab2 = 44, Bb2 = 46, C3 = 48, Db3 = 49, Eb3 = 51, F3 = 53, Gb3 = 54,
      G3 = 55, Ab3 = 56, Bb3 = 58, C4 = 60, Db4 = 61, Eb4 = 63, G4 = 67;

// ------------------------------------------------------------------ buses

const dryL = new Float32Array(NT), dryR = new Float32Array(NT);
const wetL = new Float32Array(NT), wetR = new Float32Array(NT);
const echL = new Float32Array(NT), echR = new Float32Array(NT);

// SOLO=organ,bell node public/assets/audio/dungeon-depths-2.js stem.wav — renders one group
// alone. The voices still run either way, so the random details of a stem match
// the full mix exactly and the two can be compared sample for sample.
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

const V = require('./voices')({ S, place, rnd });
const { growl, heart, skitter, drip, dripField, breath, stab, riser, chain } = V;

// ------------------------------------------------------------ arrangement

// 0-30    water in the dark        30-62   the crypt: organ, first toll
// 62-96   the choir wakes          96-124  it hunts between the pillars
// 124-158 everything at once       158-180 it empties out again
const CURVE = [
  [0, 0.12], [22, 0.14], [32, 0.42], [56, 0.48], [64, 0.68], [88, 0.72],
  [96, 0.46], [118, 0.44], [128, 1.00], [150, 0.92], [166, 0.20], [180, 0.12],
];
function section(t) {
  for (let i = 1; i < CURVE.length; i++) {
    if (t <= CURVE[i][0]) {
      const [t0, v0] = CURVE[i - 1], [t1, v1] = CURVE[i];
      return v0 + (v1 - v0) * smooth((t - t0) / (t1 - t0));
    }
  }
  return CURVE[CURVE.length - 1][1];
}

// ------------------------------------------------------- sustained drones

function renderDrone(channelSeed) {
  const src = new Float32Array(N), dst = new Float32Array(N);
  const voices = [
    { midi: C1, amp: 0.36, det: 0.09 },
    { midi: C1, amp: 0.33, det: -0.12 },
    { midi: Db1, amp: 0.12, det: 0.05 },   // the rub
    { midi: G1, amp: 0.15, det: -0.08 },
    { midi: C2, amp: 0.16, det: 0.06 },
    { midi: G2, amp: 0.06, det: -0.05 },
    { midi: Gb2, amp: 0.030, det: -0.03 },
  ];
  for (const v of voices) {
    const f = loopq(mtof(v.midi) + v.det + channelSeed);
    const w = 2 * Math.PI * f / SR;
    const ph = rnd() * Math.PI * 2;
    for (let n = 0; n < N; n++) {
      const t = w * n + ph;
      src[n] += v.amp * (Math.sin(t) + 0.26 * Math.sin(2 * t) + 0.11 * Math.sin(3 * t));
    }
  }
  const lfo1 = 2 * Math.PI * loopq(1 / 41) / SR;
  const lfo2 = 2 * Math.PI * loopq(1 / 27) / SR;
  const lfo3 = 2 * Math.PI * loopq(1 / 53) / SR;
  let lp = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let n = 0; n < N; n++) {
      const cut = 112 + 58 * Math.sin(lfo1 * n) + 26 * Math.sin(lfo2 * n + 2.2);
      lp += (1 - Math.exp(-2 * Math.PI * cut / SR)) * (src[n] - lp);
      if (pass) dst[n] = lp * (0.74 + 0.26 * Math.sin(lfo3 * n));
    }
  }
  return dst;
}

// ------------------------------------------------------------- noise beds

// Barely-moving air. A cave this deep has nowhere for wind to come from, so
// this is a fraction of the level above and the gusting is nearly flat — it
// is here to stop the silence sounding digital, and for nothing else.
function renderAir(seed) {
  const r = mulberry32(seed);
  const M = N + XF;
  const buf = new Float32Array(M);
  let brown = 0, lp = 0, hp = 0, prev = 0;
  for (let n = 0; n < M; n++) {
    brown = brown * 0.994 + (r() * 2 - 1) * 0.06;
    lp += 0.035 * (brown - lp);
    hp = 0.997 * (hp + lp - prev); prev = lp;
    const t = n / SR;
    const gust = 0.82 + 0.18 * Math.sin(2 * Math.PI * t / 31 + seed);
    buf[n] = hp * gust * 3.4;
  }
  return S.crossfadeLoop(buf);
}

function renderAbyss(seed) {
  const r = mulberry32(seed);
  const M = N + XF;
  const buf = new Float32Array(M);
  let a = 0, b = 0, c = 0;
  for (let n = 0; n < M; n++) {
    a += 0.005 * ((r() * 2 - 1) - a);
    b += 0.005 * (a - b);
    c += 0.005 * (b - c);
    const swell = 0.35 + 0.65 * smooth(Math.sin(2 * Math.PI * (n / SR) / 43) * 0.5 + 0.5);
    buf[n] = c * swell * 190;
  }
  return S.crossfadeLoop(buf);
}

function renderDust(seed) {
  const r = mulberry32(seed);
  const M = N + XF;
  const buf = new Float32Array(M);
  let hp = 0, prev = 0, lp = 0;
  for (let n = 0; n < M; n++) {
    const w = r() * 2 - 1;
    hp = 0.88 * (hp + w - prev); prev = w;
    lp += 0.30 * (hp - lp);
    const t = n / SR;
    const drift = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(2 * Math.PI * t / 17 + seed))
                           * (0.5 + 0.5 * Math.sin(2 * Math.PI * t / 5.9));
    buf[n] = lp * drift;
  }
  return S.crossfadeLoop(buf);
}

// -------------------------------------------------------- gothic voices

// Pipe organ. An organ note is not one tone: pulling a stop adds a whole rank
// of pipes at a fixed interval above the key, so the sound is built from
// octaves and fifths stacked on the fundamental. The 2-2/3' rank is the fifth
// that gives an organ its hollow, slightly sour edge.
const STOPS = [
  [0.5, 0.50],   // 16' — the pedal octave below
  [1.0, 1.00],   // 8'  — the note you played
  [2.0, 0.48],   // 4'
  [3.0, 0.26],   // 2-2/3' — the quint
  [4.0, 0.20],   // 2'
  [6.0, 0.09],   // mixture
  [8.0, 0.05],
];
function organ(tStart, midis, dur, amp, send, echo = 0.18) {
  const start = Math.round(tStart * SR);
  if (start >= N) return;
  const total = Math.round(dur * SR);
  const atk = Math.round(0.55 * SR), rel = Math.round(3.2 * SR);
  const ranks = [];
  midis.forEach((midi, mi) => {
    const f0 = mtof(midi);
    for (const [ratio, g] of STOPS) {
      // every pipe is very slightly out with every other pipe
      const det = 1 + (rnd() - 0.5) * 0.0035;
      ranks.push({
        w: 2 * Math.PI * f0 * ratio * det / SR,
        ph: rnd() * 6.28,
        g: g / (1 + mi * 0.35),
        pan: (mi / Math.max(1, midis.length - 1)) * 1.2 - 0.6,
      });
    }
  });
  // the chiff: wind noise at the mouth of the pipe as it speaks
  const chiffSt = svfState();
  const chiffF = mtof(midis[0]) * 4;
  for (let n = 0; n < total && start + n < NT; n++) {
    const t = n / SR;
    const e = n < atk ? smooth(n / atk)
            : n > total - rel ? smooth((total - n) / rel) : 1;
    const trem = 0.94 + 0.06 * Math.sin(2 * Math.PI * 5.1 * t);
    let vl = 0, vr = 0;
    for (const rk of ranks) {
      const s = Math.sin(rk.w * n + rk.ph) * rk.g;
      const [l, r] = pan2(rk.pan);
      vl += s * l; vr += s * r;
    }
    const chiff = svf(chiffSt, rnd() * 2 - 1, chiffF, 0.4) * Math.exp(-t / 0.07) * 0.5;
    place(start + n, (vl * 0.42 + chiff) * amp * e * trem, 1, 0, send, echo);
    place(start + n, (vr * 0.42 + chiff * 0.8) * amp * e * trem, 0, 1, send, echo);
  }
}

// A church bell. Bells are inharmonic on purpose: the founder tunes the hum an
// octave below the strike note and the tierce a MINOR third above it, so every
// bell tolls in a minor key whatever you ring it against. That tierce is why a
// bell sounds like mourning and a tubular chime does not.
const BELL = [
  // [ratio, amp, decay seconds]
  [0.500, 1.00, 13.0],   // hum
  [1.000, 0.80, 8.5],    // prime
  [1.190, 0.60, 6.0],    // tierce — the minor third
  [1.500, 0.42, 4.8],    // quint
  [2.000, 0.72, 4.2],    // nominal
  [2.500, 0.26, 2.8],
  [2.667, 0.20, 2.4],
  [3.000, 0.18, 2.0],
  [4.000, 0.13, 1.5],
  [5.330, 0.075, 1.0],
  [6.400, 0.045, 0.7],
];
function bell(tStart, midi, amp, panPos, send, echo = 0.3) {
  const start = Math.round(tStart * SR);
  if (start >= N) return;
  const f0 = mtof(midi);
  const [l, r] = pan2(panPos);
  const dur = Math.round(15 * SR);
  // each partial is really two, a fraction apart — that beating is the warble
  const parts = BELL.map(([ratio, g, tau]) => ({
    w1: 2 * Math.PI * f0 * ratio / SR,
    w2: 2 * Math.PI * (f0 * ratio + 0.25 + rnd() * 0.9) / SR,
    ph: rnd() * 6.28, g, tau,
  }));
  const st = svfState();
  for (let n = 0; n < dur && start + n < NT; n++) {
    const t = n / SR;
    let s = 0;
    for (const p of parts) {
      s += (Math.sin(p.w1 * n + p.ph) + Math.sin(p.w2 * n)) * 0.5 * p.g * Math.exp(-t / p.tau);
    }
    // the clapper
    const strike = svf(st, rnd() * 2 - 1, f0 * 5.5, 0.25) * Math.exp(-t / 0.012) * 0.6;
    place(start + n, (s * 0.34 + strike) * amp, l, r, send, echo);
  }
}

// A low male choir. Same machine as the growl — a buzzing source through a
// formant bank — but the source is in tune, there is no fry, and every singer
// drifts on their own. The drift is the whole trick: three exact copies sound
// like one synthesiser, three inexact ones sound like people.
const VOWELS = {
  oo: [[320, 1.00], [800, 0.26], [2400, 0.05]],
  oh: [[450, 1.00], [760, 0.40], [2500, 0.08]],
  ah: [[700, 1.00], [1150, 0.48], [2600, 0.10]],
};
function choir(tStart, midis, dur, amp, vowel, send, echo = 0.2) {
  const start = Math.round(tStart * SR);
  if (start >= N) return;
  const total = Math.round(dur * SR);
  const F = VOWELS[vowel];
  const singers = [];
  midis.forEach((midi, mi) => {
    for (let k = 0; k < 3; k++) {
      singers.push({
        f: mtof(midi) * (1 + (rnd() - 0.5) * 0.012),
        ph: rnd(),
        vibF: 4.4 + rnd() * 1.6,
        vibP: rnd() * 6.28,
        driftP: rnd() * 6.28,
        st: F.map(svfState),
        lp: 0,
        pan: (mi / Math.max(1, midis.length - 1)) * 1.3 - 0.65 + (k - 1) * 0.12,
      });
    }
  });
  const atk = total * 0.30, rel = total * 0.55;
  for (let n = 0; n < total && start + n < NT; n++) {
    const t = n / SR;
    const e = n < atk ? smooth(n / atk) : smooth((total - n) / rel);
    let vl = 0, vr = 0;
    for (const sg of singers) {
      const vib = 1 + 0.004 * Math.sin(2 * Math.PI * sg.vibF * t + sg.vibP)
                    + 0.003 * Math.sin(2 * Math.PI * 0.23 * t + sg.driftP);
      sg.ph += sg.f * vib / SR; if (sg.ph >= 1) sg.ph -= 1;
      let src = 2 * sg.ph - 1;
      sg.lp += 0.18 * (src - sg.lp);            // soften the glottal buzz
      src = sg.lp + (rnd() * 2 - 1) * 0.05;     // a little breath
      let out = 0;
      for (let k = 0; k < F.length; k++) out += svf(sg.st[k], src, F[k][0], 0.20) * F[k][1];
      out += sg.lp * 0.35;                      // the fundamental the formants filtered out
      const [l, r] = pan2(sg.pan);
      vl += out * l; vr += out * r;
    }
    place(start + n, vl * 0.44 * amp * e, 1, 0, send, echo);
    place(start + n, vr * 0.44 * amp * e, 0, 1, send, echo);
  }
}

// ------------------------------------------------------------- the score

// Water, everywhere, the whole time. Several sources at their own rough
// periods, so they never line up.
group = 'water';
// Water in the opening, then it drains away: the field thins and fades out
// across the second half of the first minute, and does not come back.
dripField(0, 52, 6, 0.200, 0.86, 26);
dripField(0, 44, 3, 0.100, 0.90, 22);      // further off, deeper in the room

// A handful right next to you — dry, so they land in front of the room. The
// last two are the only water after the first minute.
drip(6.2, 1240, 0.175, -0.55, 0.52);
drip(19.4, 880, 0.160, 0.60, 0.50);
drip(33.1, 1620, 0.130, -0.30, 0.55);
drip(108.6, 1030, 0.115, 0.45, 0.50);
drip(161.3, 1380, 0.105, -0.50, 0.54);

// The organ. Open fifths first — medieval, not romantic — then the b2 rub,
// then everything including the tritone.
group = 'organ';
organ(30.0, [C2, G2, C3], 27, 0.144, 0.68);
organ(63.0, [C2, G2, Db3], 25, 0.163, 0.66);
organ(96.5, [Ab2, Eb3, Ab3], 17, 0.119, 0.70);
organ(127.0, [C1, C2, G2, Eb3, Db4], 27, 0.188, 0.61);
organ(159.0, [C2, G2], 21, 0.112, 0.72);

// The bell. One toll on its own to open the crypt, then it keeps time for the
// rest of the piece — the only thing down here that does.
group = 'bell';
bell(28.0, C2, 0.253, -0.25, 0.81);
bell(47.5, C2, 0.198, 0.30, 0.83);
bell(67.0, G2, 0.187, -0.35, 0.83);
bell(90.5, C2, 0.231, 0.20, 0.79);
bell(126.5, C2, 0.297, -0.15, 0.75);
bell(138.0, Ab2, 0.253, 0.35, 0.77);
bell(149.5, C2, 0.264, -0.30, 0.77);
bell(171.0, G2, 0.154, 0.40, 0.85);

// The choir.
group = 'choir';
choir(56.0, [C3, G3], 19, 0.138, 'oo', 0.72);
choir(87.0, [C3, Db3, G3], 17, 0.150, 'oh', 0.72);
choir(126.0, [C3, Eb3, G3, Db4], 23, 0.112, 'oh', 0.68);
choir(146.0, [Db3, Gb3, Ab3], 15, 0.100, 'oo', 0.75);
choir(163.5, [C3, G3], 16, 0.090, 'oo', 0.77);

// The creature, unchanged from the level above because you liked it.
group = 'growl';
growl(17.5, 4.5, 57, 0.27, -0.60, 0.78, 0.35);
growl(51.0, 5.0, 52, 0.30, 0.42, 0.68, 0.30);
growl(78.0, 4.0, 60, 0.28, -0.30, 0.70, 0.30);
growl(99.0, 6.0, 46, 0.40, 0.25, 0.66, 0.28);
growl(121.0, 4.0, 55, 0.44, -0.35, 0.62, 0.25);
growl(131.5, 3.5, 43, 0.92, -0.05, 0.36, 0.16);   // in the room with you
growl(143.0, 6.5, 50, 0.64, 0.18, 0.46, 0.20);
growl(168.5, 5.0, 56, 0.18, 0.68, 0.84, 0.40);    // going

// Claws.
group = 'claws';
skitter(12.0, 1.4, 8, 0.060, 0.85, 0.90);
skitter(43.0, 1.1, 13, 0.075, 0.80, 0.86);
skitter(70.5, 1.5, 16, 0.085, 0.85, 0.86);
skitter(93.0, 0.8, 15, 0.090, 0.60, 0.84);
skitter(112.0, 1.3, 14, 0.080, 0.90, 0.88);
skitter(124.0, 1.0, 18, 0.100, 0.70, 0.82);
skitter(133.5, 1.2, 22, 0.115, 0.45, 0.78);
skitter(141.0, 0.6, 18, 0.120, 0.35, 0.76);
skitter(153.0, 1.4, 20, 0.100, 0.55, 0.80);
skitter(174.0, 1.8, 7, 0.048, 0.95, 0.92);

// Lungs.
group = 'breath';
breath(21.5, 2, 4.6, 0.045, 0.55);
breath(74.0, 3, 4.2, 0.058, -0.35);
breath(114.0, 3, 4.8, 0.052, 0.30);
breath(134.0, 5, 3.6, 0.072, -0.15);

// A pulse, once you have been noticed. It stops while it hunts, then returns.
group = 'heart';
{
  let t = 40;
  while (t < 92) { heart(t, 0.19 + 0.10 * section(t), (rnd() - 0.5) * 0.3); t += 2.4 - 0.9 * section(t) + rnd() * 0.3; }
  t = 118;
  while (t < 176) {
    const urgency = section(t);
    heart(t, 0.19 + 0.16 * urgency, (rnd() - 0.5) * 0.3);
    t += 2.2 - 1.1 * urgency + rnd() * 0.25;
  }
}

// Metal, and one place where the whole room hits at once.
group = 'metal';
chain(45.0, 3.2, 0.048, -0.70);
chain(107.0, 4.0, 0.052, 0.65);
riser(120.0, 6.5, 0.070, 0.50, Db3);
stab(127.0, [C3, Db3, Gb3], 0.100, 0.82);
stab(150.0, [Db3, Gb3, Db4], 0.080, 0.86);

// --------------------------------------------------------- corridor + room

const [ecL, ecR] = S.pingpong(echL, echR, 371, 557, 0.42, 0.50);
for (let n = 0; n < NT; n++) {
  dryL[n] += ecL[n] * 0.50; wetL[n] += ecL[n] * 0.70;
  dryR[n] += ecR[n] * 0.50; wetR[n] += ecR[n] * 0.70;
}

// A vaulted crypt rather than a plain cave: a little longer than the level
// above, and open enough at the top for the bell to keep some shimmer.
function shapeWet(x) {
  const kl = 1 - Math.exp(-2 * Math.PI * 4200 / SR);
  let lp = 0, hp = 0, prev = 0;
  for (let n = 0; n < x.length; n++) {
    lp += kl * (x[n] - lp);
    hp = 0.994 * (hp + lp - prev); prev = lp;
    x[n] = hp;
  }
}

const rvL = S.reverb(S.predelay(wetL, 26), [2699, 3067, 3491, 3821], [347, 163, 71], 5.0, 0.38);
const rvR = S.reverb(S.predelay(wetR, 31), [2777, 3163, 3571, 3917], [359, 173, 79], 5.0, 0.38);
shapeWet(rvL); shapeWet(rvR);

// ---------------------------------------------------------------- the mix

const outL = new Float32Array(NT), outR = new Float32Array(NT);
for (let n = 0; n < NT; n++) {
  outL[n] = dryL[n] * 0.58 + rvL[n] * 1.00;
  outR[n] = dryR[n] * 0.58 + rvR[n] * 1.00;
}

for (let n = 0; n < NT - N; n++) {
  outL[n] += outL[N + n];
  outR[n] += outR[N + n];
}

const droL = renderDrone(0.000), droR = renderDrone(0.027);
const airL = renderAir(2718), airR = renderAir(3141);
const abyL = renderAbyss(1618), abyR = renderAbyss(6180);
const dusL = renderDust(4770), dusR = renderDust(9110);
for (let n = 0; n < N; n++) {
  const s = (section(n / SR) - 0.12) / 0.88;
  const dg = 0.16 + 0.26 * s, ag = 0.055 + 0.105 * s;
  // air is at a third of the level above — this room has no wind in it
  if (!on('beds')) continue;
  outL[n] += droL[n] * dg + airL[n] * 0.048 + abyL[n] * ag + dusL[n] * 0.024;
  outR[n] += droR[n] * dg + airR[n] * 0.048 + abyR[n] * ag + dusR[n] * 0.024;
}

const loopL = outL.subarray(0, N), loopR = outR.subarray(0, N);
S.hpLoop(loopL, 26); S.hpLoop(loopL, 26);
S.hpLoop(loopR, 26); S.hpLoop(loopR, 26);

const { peak, gain } = S.master(outL, outR);

// A stem must be written at the full mix's gain or its level means nothing.
// The full render records the gain it used; stems read it back.
const gainFile = path.join(__dirname, '.mixgain-depths-2');
if (!SOLO) require('fs').writeFileSync(gainFile, String(gain));
const g2 = SOLO ? Number(require('fs').readFileSync(gainFile, 'utf8')) : gain;

// ------------------------------------------------------------- write wave

const outPath = process.argv[2] || path.join(__dirname, 'dungeon-depths-2.wav');
const bytes = S.writeWav(outPath, outL, outR, g2);

console.log(`${outPath}  ${LEN}s  ${SR}Hz stereo  peak ${(peak * gain).toFixed(3)}  ${(bytes / 1048576).toFixed(1)} MB`);
