// dungeon-depths.js — the level below dungeon-crawl, with something living on it.
//
// Same synthesis approach as its sibling, but the room is smaller, the key is
// a semitone lower, and the arrangement is built around a creature rather than
// around an empty space: a throat, a heartbeat, claws on stone, and the moment
// they stop being distant.
//
//   node assets/audio/dungeon-depths.js [out.wav]

const path = require('path');

const LEN = 180;
const TAIL = 9;
const S = require('./synth')({ LEN, TAIL });
const { SR, N, NT, XFN: XF, mulberry32, mtof, loopq, smooth, pan2, svf, svfState } = S;

const rnd = mulberry32(0x5eb17e5);

// C phrygian. Db against C is the b2 — the nastiest interval in the set — and
// Gb is the tritone. Everything here leans on one or the other.
const C1 = 24, Db1 = 25, G1 = 31, C2 = 36, Db2 = 37, Gb2 = 42, G2 = 43,
      C3 = 48, Db3 = 49, E3 = 52, F3 = 53, Gb3 = 54, Ab3 = 56, Bb3 = 58,
      C4 = 60, Db4 = 61, Gb4 = 66;

// ------------------------------------------------------------------ buses

const dryL = new Float32Array(NT), dryR = new Float32Array(NT);
const wetL = new Float32Array(NT), wetR = new Float32Array(NT);  // to the room
const echL = new Float32Array(NT), echR = new Float32Array(NT);  // to the corridor

function place(i, v, l, r, send, echo = 0) {
  if (i >= NT) return;
  const vl = v * l, vr = v * r;
  dryL[i] += vl; dryR[i] += vr;
  wetL[i] += vl * send; wetR[i] += vr * send;
  if (echo) { echL[i] += vl * echo; echR[i] += vr * echo; }
}

// ------------------------------------------------------------ arrangement

// 0-28    holding your breath      28-62   something is awake
// 62-92   it knows where you are   92-124  it circles
// 124-158 it is on you             158-180 it loses you, and the loop restarts
//
// Breakpoints rather than steps: a step function would jump the bed gains
// audibly at every boundary, and the last value has to meet the first or the
// loop point steps too.
const CURVE = [
  [0, 0.15], [24, 0.15], [34, 0.45], [58, 0.50], [68, 0.72], [90, 0.78],
  [98, 0.48], [120, 0.45], [129, 1.00], [152, 0.95], [164, 0.22], [180, 0.15],
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

// C1 with a Db1 rubbing against it. They are ~2 Hz apart down there, so the
// pair beats about twice a second — the bed is never quite still.
function renderDrone(channelSeed) {
  const src = new Float32Array(N), dst = new Float32Array(N);
  const voices = [
    { midi: C1, amp: 0.36, det: 0.09 },
    { midi: C1, amp: 0.33, det: -0.12 },
    { midi: Db1, amp: 0.14, det: 0.05 },   // the rub
    { midi: G1, amp: 0.15, det: -0.08 },
    { midi: C2, amp: 0.16, det: 0.06 },
    { midi: G2, amp: 0.06, det: -0.05 },
    { midi: Gb2, amp: 0.035, det: -0.03 }, // the tritone, barely there
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
  // Darker and lower than the level above: this filter barely opens. Two
  // passes so the state is periodic and the loop point stays continuous.
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

function renderAir(seed) {
  const r = mulberry32(seed);
  const M = N + XF;
  const buf = new Float32Array(M);
  let brown = 0, lp = 0, hp = 0, prev = 0;
  for (let n = 0; n < M; n++) {
    brown = brown * 0.993 + (r() * 2 - 1) * 0.06;
    lp += 0.05 * (brown - lp);
    hp = 0.997 * (hp + lp - prev); prev = lp;
    const t = n / SR;
    const gust = 0.5 + 0.5 * Math.sin(2 * Math.PI * t / 29 + seed)
                          * Math.sin(2 * Math.PI * t / 11.3);
    buf[n] = hp * gust * 3.4;
  }
  return S.crossfadeLoop(buf);
}

// The floor of the whole piece. Deeper and slower than the level above.
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

// A trace of high hiss so the mix is not entirely mud.
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

// ---------------------------------------------------------------- voices

const { growl, heart, skitter, breath, stab, riser, chain, pluck } =
  require('./voices')({ S, place, rnd });

// ------------------------------------------------------------- the score

// Heartbeat. It starts once you are noticed, stops dead after the stab at 92
// while the thing circles, then comes back faster and does not stop.
{
  let t = 37;
  while (t < 90) { heart(t, 0.20 + 0.10 * section(t), (rnd() - 0.5) * 0.3); t += 2.4 - 0.9 * section(t) + rnd() * 0.3; }
  t = 106;
  while (t < 172) {
    const urgency = section(t);
    heart(t, 0.20 + 0.16 * urgency, (rnd() - 0.5) * 0.3);
    t += 2.2 - 1.1 * urgency + rnd() * 0.25;
  }
}

// The creature. Far off, then not.
growl(31, 5.5, 58, 0.22, -0.55, 0.76, 0.35);
growl(74, 4.5, 52, 0.32, 0.40, 0.68, 0.30);
growl(101, 6.0, 47, 0.27, -0.25, 0.72, 0.30);
growl(118, 5.0, 61, 0.35, 0.30, 0.63, 0.25);
growl(129, 3.5, 44, 0.46, -0.10, 0.48, 0.20);   // close enough to be dry
growl(143, 6.5, 50, 0.43, 0.15, 0.52, 0.20);
growl(167, 5.0, 56, 0.19, 0.65, 0.82, 0.40);    // going away again

// Claws.
skitter(14.0, 1.4, 9, 0.0743, 0.85, 0.86);
skitter(44.5, 1.1, 14, 0.0945, 0.80, 0.84);
skitter(57.0, 0.9, 11, 0.0878, 0.75, 0.84);
skitter(70.0, 1.6, 18, 0.1080, 0.85, 0.82);
skitter(88.0, 0.7, 16, 0.1215, 0.60, 0.79);
skitter(109.0, 1.3, 13, 0.1013, 0.90, 0.84);
skitter(121.0, 1.0, 15, 0.1148, 0.70, 0.82);
skitter(127.5, 0.8, 20, 0.1418, 0.50, 0.74);
skitter(134.0, 1.2, 22, 0.1485, 0.45, 0.72);
skitter(140.0, 0.6, 18, 0.1553, 0.35, 0.72);
skitter(151.0, 1.4, 24, 0.1350, 0.55, 0.74);
skitter(172.0, 1.8, 8, 0.0607, 0.95, 0.88);

// Breathing.
breath(21.0, 2, 4.6, 0.045, 0.55);
breath(66.0, 4, 4.2, 0.060, -0.35);
breath(112.0, 3, 4.8, 0.055, 0.30);
breath(133.0, 5, 3.6, 0.075, -0.15);

// Risers and the clusters they land on.
riser(85.0, 7.0, 0.085, 0.55);
stab(92.0, [C3, Db3, Gb3], 0.115, 0.85);
riser(124.5, 6.5, 0.075, 0.50);
stab(131.0, [C3, Db3, E3, Gb3], 0.105, 0.80);
stab(147.5, [Db3, Gb3, Ab3, Db4], 0.090, 0.85);
stab(157.0, [C2, Db2], 0.070, 0.90);

// Metal.
chain(48.0, 3.2, 0.045, -0.70);
chain(110.0, 4.0, 0.050, 0.65);
chain(154.5, 2.6, 0.055, -0.45);

// What is left of the guitar.
pluck(8.5, C2, 0.16, -0.4, 0.90);
pluck(26.0, G2, 0.14, 0.5, 0.90);
pluck(53.0, C3, 0.15, -0.6, 0.88);
pluck(63.5, Db3, 0.17, 0.25, 0.88);
pluck(79.0, Gb3, 0.15, -0.3, 0.90);
pluck(96.5, C2, 0.19, 0.0, 0.86);
pluck(105.0, Db2, 0.16, 0.55, 0.88);
pluck(116.0, Bb3, 0.12, -0.5, 0.90);
pluck(138.0, Gb4, 0.10, 0.6, 0.92);
pluck(145.0, C4, 0.13, -0.2, 0.88);
pluck(162.0, F3, 0.13, 0.35, 0.90);
pluck(176.0, C2, 0.12, 0.0, 0.90);

// --------------------------------------------------------- corridor + room

// The corridor first: its repeats feed the room, so echoes arrive wet.
const [ecL, ecR] = S.pingpong(echL, echR, 371, 557, 0.42, 0.50);
for (let n = 0; n < NT; n++) {
  dryL[n] += ecL[n] * 0.50; wetL[n] += ecL[n] * 0.70;
  dryR[n] += ecR[n] * 0.50; wetR[n] += ecR[n] * 0.70;
}

// A smaller, darker, wetter room than the level above: stone close on all
// sides rather than a cathedral.
function shapeWet(x) {
  const kl = 1 - Math.exp(-2 * Math.PI * 3800 / SR);
  let lp = 0, hp = 0, prev = 0;
  for (let n = 0; n < x.length; n++) {
    lp += kl * (x[n] - lp);
    hp = 0.994 * (hp + lp - prev); prev = lp;
    x[n] = hp;
  }
}

const rvL = S.reverb(S.predelay(wetL, 22), [2477, 2801, 3203, 3527], [347, 163, 71], 4.2, 0.42);
const rvR = S.reverb(S.predelay(wetR, 27), [2551, 2887, 3299, 3607], [359, 173, 79], 4.2, 0.42);
shapeWet(rvL); shapeWet(rvR);

// ---------------------------------------------------------------- the mix

const outL = new Float32Array(NT), outR = new Float32Array(NT);
for (let n = 0; n < NT; n++) {
  outL[n] = dryL[n] * 0.58 + rvL[n] * 1.00;
  outR[n] = dryR[n] * 0.58 + rvR[n] * 1.00;
}

// fold the tail back over the head — this is what makes the loop seamless
for (let n = 0; n < NT - N; n++) {
  outL[n] += outL[N + n];
  outR[n] += outR[N + n];
}

const droL = renderDrone(0.000), droR = renderDrone(0.027);
const airL = renderAir(2718), airR = renderAir(3141);
const abyL = renderAbyss(1618), abyR = renderAbyss(6180);
const dusL = renderDust(4770), dusR = renderDust(9110);
for (let n = 0; n < N; n++) {
  // The beds open up with the section, so the first half-minute really is
  // nearly empty — that is what buys the rest of it any weight.
  const s = (section(n / SR) - 0.15) / 0.85;
  const dg = 0.16 + 0.26 * s, ag = 0.055 + 0.105 * s;
  outL[n] += droL[n] * dg + airL[n] * 0.15 + abyL[n] * ag + dusL[n] * 0.024;
  outR[n] += droR[n] * dg + airR[n] * 0.15 + abyR[n] * ag + dusR[n] * 0.024;
}

// kill DC and the sub that is felt but never heard
const loopL = outL.subarray(0, N), loopR = outR.subarray(0, N);
S.hpLoop(loopL, 26); S.hpLoop(loopL, 26);
S.hpLoop(loopR, 26); S.hpLoop(loopR, 26);

const { peak, gain } = S.master(outL, outR);

// ------------------------------------------------------------- write wave

const outPath = process.argv[2] || path.join(__dirname, 'dungeon-depths.wav');
const bytes = S.writeWav(outPath, outL, outR, gain);

console.log(`${outPath}  ${LEN}s  ${SR}Hz stereo  peak ${(peak * gain).toFixed(3)}  ${(bytes / 1048576).toFixed(1)} MB`);
