// dungeon-crawl.js — a dark dungeon-crawl ambience, Diablo-1 flavoured.
//
// Everything is synthesised from scratch: detuned drones, Karplus-Strong
// plucks, bowed clusters, dull impacts, distant metal and a big Schroeder
// cavern. No dependencies, no samples.
//
//   node tools/audio/dungeon-crawl.js [out.wav]
//
// The result is a seamless loop: the reverb tail is folded back onto the
// head, and every sustained oscillator is tuned to a whole number of cycles
// per loop, so the splice is silent.

const path = require('path');

const LEN = 180;   // loop length, seconds
const TAIL = 9;    // extra render for the reverb tail
const S = require('./synth')({ LEN, TAIL });
const { SR, N, NT, XFN: XF, mulberry32, mtof, loopq, smooth, pan2 } = S;

const rnd = mulberry32(0x0d1ab10);

// D phrygian, the dungeon home key. Ab is the tritone we lean on.
const D1 = 26, A1 = 33, D2 = 38, A2 = 45, D3 = 50, Eb3 = 51, F3 = 53,
      Ab3 = 56, A3 = 57, Bb3 = 58, C4 = 60, D4 = 62, F4 = 65;

// ------------------------------------------------------------------ buses

const dryL = new Float32Array(NT), dryR = new Float32Array(NT);
const wetL = new Float32Array(NT), wetR = new Float32Array(NT);

// ------------------------------------------------------- sustained drones

// Two independent renders (one per channel) give the drone real width
// without any stereo trickery.
function renderDrone(channelSeed) {
  const src = new Float32Array(N), dst = new Float32Array(N);
  const voices = [
    { midi: D1, amp: 0.34, det: 0.11 },
    { midi: D1, amp: 0.31, det: -0.13 },
    { midi: A1, amp: 0.17, det: 0.07 },
    { midi: A1, amp: 0.16, det: -0.09 },
    { midi: D2, amp: 0.11, det: 0.05 },
    { midi: A2, amp: 0.05, det: -0.04 },
  ];
  for (const v of voices) {
    const f = loopq(mtof(v.midi) + v.det + channelSeed);
    const w = 2 * Math.PI * f / SR;
    const ph = rnd() * Math.PI * 2;
    // sine plus a touch of 2nd/3rd for body — a pure sine is too clean
    for (let n = 0; n < N; n++) {
      const t = w * n + ph;
      src[n] += v.amp * (Math.sin(t) + 0.22 * Math.sin(2 * t) + 0.09 * Math.sin(3 * t));
    }
  }
  // Slow filter breathing: the room seems to inhale. Two passes — the first
  // only settles the filter state, so the drone is already in steady state at
  // sample 0 and the loop point stays continuous.
  const lfo1 = 2 * Math.PI * loopq(1 / 47) / SR;
  const lfo2 = 2 * Math.PI * loopq(1 / 31) / SR;
  const lfo3 = 2 * Math.PI * loopq(1 / 59) / SR;
  let lp = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let n = 0; n < N; n++) {
      const cut = 130 + 95 * Math.sin(lfo1 * n) + 40 * Math.sin(lfo2 * n + 1.7);
      lp += (1 - Math.exp(-2 * Math.PI * cut / SR)) * (src[n] - lp);
      if (pass) dst[n] = lp * (0.80 + 0.20 * Math.sin(lfo3 * n));
    }
  }
  return dst;
}

// ------------------------------------------------------------- noise beds

// Air moving through stone.
function renderAir(seed) {
  const r = mulberry32(seed);
  const M = N + XF;
  const buf = new Float32Array(M);
  let brown = 0, lp = 0, hp = 0, prev = 0;
  for (let n = 0; n < M; n++) {
    brown = brown * 0.992 + (r() * 2 - 1) * 0.06;
    lp += 0.06 * (brown - lp);          // keep it dull
    hp = 0.997 * (hp + lp - prev); prev = lp;
    const t = n / SR;
    const gust = 0.55 + 0.45 * Math.sin(2 * Math.PI * t / 23 + seed)
                            * Math.sin(2 * Math.PI * t / 8.3);
    buf[n] = hp * gust * 3.2;
  }
  return S.crossfadeLoop(buf);
}

// Sub-bass floor rumble — felt more than heard.
function renderRumble(seed) {
  const r = mulberry32(seed);
  const M = N + XF;
  const buf = new Float32Array(M);
  let a = 0, b = 0;
  for (let n = 0; n < M; n++) {
    a += 0.006 * ((r() * 2 - 1) - a);
    b += 0.006 * (a - b);
    const swell = 0.4 + 0.6 * smooth(Math.sin(2 * Math.PI * (n / SR) / 37) * 0.5 + 0.5);
    buf[n] = b * swell * 26;
  }
  return S.crossfadeLoop(buf);
}

// The faintest hiss of damp air high up in the vault. Without it the mix is
// so bass-heavy it sounds like it is playing through a wall.
function renderDust(seed) {
  const r = mulberry32(seed);
  const M = N + XF;
  const buf = new Float32Array(M);
  let hp = 0, prev = 0, lp = 0;
  for (let n = 0; n < M; n++) {
    const w = r() * 2 - 1;
    hp = 0.86 * (hp + w - prev); prev = w;
    lp += 0.35 * (hp - lp);
    const t = n / SR;
    const drift = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(2 * Math.PI * t / 19 + seed))
                             * (0.5 + 0.5 * Math.sin(2 * Math.PI * t / 6.7));
    buf[n] = lp * drift;
  }
  return S.crossfadeLoop(buf);
}

// ----------------------------------------------------------- event voices

function place(i, v, l, r, send) {
  if (i >= NT) return;
  const vl = v * l, vr = v * r;
  dryL[i] += vl; dryR[i] += vr;
  wetL[i] += vl * send; wetR[i] += vr * send;
}

// A struck string, damped almost to death. This is the sound that says
// someone else is down here with you.
function pluck(tStart, midi, amp, panPos, send, damp = 0.9988, bright = 0.16) {
  const start = Math.round(tStart * SR);
  if (start >= N) return;
  const M = Math.max(2, Math.round(SR / mtof(midi)));
  const buf = new Float32Array(M);
  let lp = 0;
  for (let i = 0; i < M; i++) { lp += bright * ((rnd() * 2 - 1) - lp); buf[i] = lp; }
  // remove DC so the note does not thump, then normalise the burst
  let dc = 0;
  for (let i = 0; i < M; i++) dc += buf[i];
  dc /= M;
  let pk = 0;
  for (let i = 0; i < M; i++) { buf[i] -= dc; pk = Math.max(pk, Math.abs(buf[i])); }
  if (pk > 0) for (let i = 0; i < M; i++) buf[i] /= pk;

  const [l, r] = pan2(panPos);
  const dur = Math.min(NT - start, Math.round(11 * SR));
  let idx = 0;
  for (let n = 0; n < dur; n++) {
    const cur = buf[idx];
    buf[idx] = damp * 0.5 * (cur + buf[(idx + 1) % M]);
    idx = idx + 1 === M ? 0 : idx + 1;
    const fade = n < dur - SR ? 1 : (dur - n) / SR;   // clean ending
    place(start + n, cur * amp * fade, l, r, send);
  }
}

// A bowed / breathed cluster tone. Slow in, slower out.
function bowed(tStart, midi, dur, amp, panPos, send) {
  const start = Math.round(tStart * SR);
  if (start >= N) return;
  const f = mtof(midi);
  const [l, r] = pan2(panPos);
  const total = Math.round(dur * SR);
  const atk = total * 0.38, rel = total * 0.62;
  const w1 = 2 * Math.PI * (f + 0.13) / SR, w2 = 2 * Math.PI * (f - 0.11) / SR;
  const p1 = rnd() * 6.28, p2 = rnd() * 6.28;
  const vib = 2 * Math.PI * (0.11 + rnd() * 0.07) / SR;
  let lp = 0;
  for (let n = 0; n < total && start + n < NT; n++) {
    const e = n < atk ? smooth(n / atk) : smooth((total - n) / rel);
    const t1 = w1 * n + p1, t2 = w2 * n + p2;
    const s = Math.sin(t1) + Math.sin(t2)
            + 0.30 * Math.sin(2 * t1) + 0.13 * Math.sin(3 * t2)
            + 0.06 * Math.sin(5 * t1);
    lp += 0.10 * (s - lp);
    place(start + n, lp * amp * e * (0.82 + 0.18 * Math.sin(vib * n)), l, r, send);
  }
}

// Something heavy settling in the dark.
function thud(tStart, amp, panPos) {
  const start = Math.round(tStart * SR);
  const [l, r] = pan2(panPos);
  const dur = Math.round(2.2 * SR);
  let ph = 0, lp = 0;
  for (let n = 0; n < dur && start + n < NT; n++) {
    const t = n / SR;
    ph += 2 * Math.PI * (38 + 78 * Math.exp(-t / 0.06)) / SR;   // pitch drop
    const body = Math.sin(ph) * Math.exp(-t / 0.42);
    lp += 0.35 * ((rnd() * 2 - 1) - lp);
    const air = lp * Math.exp(-t / 0.045) * 0.55;
    place(start + n, (body + air) * amp, l, r, 0.45);
  }
}

// Far-off metal: a chain, a gate, a cage. Inharmonic, and almost all reverb.
function clang(tStart, base, amp, panPos) {
  const start = Math.round(tStart * SR);
  const [l, r] = pan2(panPos);
  const ratios = [1, 1.73, 2.41, 3.14, 4.09, 5.66, 7.21];
  const dur = Math.round(6 * SR);
  for (let n = 0; n < dur && start + n < NT; n++) {
    const t = n / SR;
    let s = 0;
    for (let k = 0; k < ratios.length; k++) {
      s += Math.sin(2 * Math.PI * base * ratios[k] * t + k)
         * Math.exp(-t / (2.4 / (1 + k * 0.8))) / (1 + k * 1.3);
    }
    place(start + n, s * amp, l, r, 0.95);
  }
}

// A resonance sweeping through the noise floor — a scrape, a breath, a
// something. State-variable filter so the sweep stays stable.
function scrape(tStart, dur, f0, f1, amp, panPos) {
  const start = Math.round(tStart * SR);
  const [l, r] = pan2(panPos);
  const total = Math.round(dur * SR);
  const q = 0.06;
  let low = 0, band = 0;
  for (let n = 0; n < total && start + n < NT; n++) {
    const x = n / total;
    const f = 2 * Math.sin(Math.PI * (f0 * Math.pow(f1 / f0, x)) / SR);
    band += f * ((rnd() * 2 - 1) - low - q * band);
    low += f * band;
    const e = Math.sin(Math.PI * x);
    place(start + n, band * amp * e * e, l, r, 0.9);
  }
}

// ------------------------------------------------------------ arrangement

// A: 0-34   empty corridor         B: 34-78   something is following
// C: 78-112 it stops moving        D: 112-152 it is close
// E: 152-180 it withdraws, and the loop begins again
const section = t =>
  t < 34 ? 0.35 :
  t < 78 ? 0.60 :
  t < 112 ? 0.45 :
  t < 152 ? 1.00 : 0.40;

// Sparse plucks, irregular on purpose — nothing down here keeps time.
const pluckNotes = [D2, D2, A2, D3, Eb3, F3, D3, A2, Ab3, Bb3, C4, D3, F3, A3, D4];
{
  let t = 9.5;
  while (t < 176) {
    const inten = section(t);
    const pick = pluckNotes[Math.floor(rnd() * pluckNotes.length)];
    const midi = t > 112 && rnd() < 0.28 ? Ab3 : pick;   // the tritone bites late
    pluck(t, midi,
      (0.20 + rnd() * 0.18) * (0.55 + inten * 0.6),
      (rnd() * 2 - 1) * 0.75,
      0.82 + rnd() * 0.14,
      0.9986 + rnd() * 0.0009,
      0.17 + rnd() * 0.17);
    // a grace note answering itself in the dark
    if (rnd() < 0.22) pluck(t + 0.4 + rnd() * 0.5, midi - 12, 0.13, (rnd() * 2 - 1) * 0.8, 0.9);
    t += (3.4 + rnd() * 6.5) * (1.35 - inten * 0.45);
  }
}

// Bowed clusters. The Eb over D and the Ab tritone are the whole mood.
bowed(35, D3, 30, 0.085, -0.35, 0.85);
bowed(39, A3, 28, 0.055, 0.40, 0.85);
bowed(53, Eb3, 22, 0.060, 0.10, 0.90);
bowed(70, D4, 16, 0.030, -0.55, 0.92);
bowed(113, D3, 34, 0.090, 0.30, 0.85);
bowed(116, Ab3, 31, 0.070, -0.30, 0.92);
bowed(127, F3, 24, 0.048, 0.55, 0.88);
bowed(136, Bb3, 20, 0.040, -0.60, 0.90);
bowed(141, F4, 14, 0.022, 0.00, 0.94);
bowed(150, A2, 28, 0.070, 0.00, 0.80);

// Impacts
thud(79.0, 0.34, -0.20);
thud(87.6, 0.30, 0.25);
thud(96.9, 0.36, -0.10);
thud(105.8, 0.28, 0.15);
thud(112.4, 0.42, 0.00);
thud(137.2, 0.33, -0.30);
thud(168.0, 0.24, 0.20);

// Distant metal
clang(44.0, 214, 0.055, 0.70);
clang(95.5, 173, 0.048, -0.75);
clang(128.3, 241, 0.052, 0.60);
clang(160.0, 197, 0.038, -0.55);

// Scrapes and breaths
scrape(19.0, 4.0, 380, 1250, 0.055, 0.65);
scrape(68.5, 3.2, 1400, 420, 0.045, -0.70);
scrape(103.0, 5.0, 260, 900, 0.060, 0.15);
scrape(144.5, 3.6, 1600, 520, 0.050, -0.45);
scrape(173.0, 4.4, 520, 300, 0.040, 0.35);

// ------------------------------------------------------------- the cavern

// tame the wet: no mud below, no glare above
function shapeWet(x) {
  const kl = 1 - Math.exp(-2 * Math.PI * 5200 / SR);
  let lp = 0, hp = 0, prev = 0;
  for (let n = 0; n < x.length; n++) {
    lp += kl * (x[n] - lp);
    hp = 0.994 * (hp + lp - prev); prev = lp;
    x[n] = hp;
  }
}

const RT = 5.8, DAMP = 0.24;
const rvL = S.reverb(S.predelay(wetL, 41), [3491, 3931, 4327, 4801], [449, 199, 89], RT, DAMP);
const rvR = S.reverb(S.predelay(wetR, 47), [3583, 4013, 4409, 4877], [463, 211, 97], RT, DAMP);
shapeWet(rvL); shapeWet(rvR);

// ---------------------------------------------------------------- the mix

const outL = new Float32Array(NT), outR = new Float32Array(NT);
for (let n = 0; n < NT; n++) {
  outL[n] = dryL[n] * 0.52 + rvL[n] * 1.05;
  outR[n] = dryR[n] * 0.52 + rvR[n] * 1.05;
}

// fold the tail back over the head — this is what makes the loop seamless
for (let n = 0; n < NT - N; n++) {
  outL[n] += outL[N + n];
  outR[n] += outR[N + n];
}

// beds go in after the fold; they already loop on their own
const droL = renderDrone(0.000), droR = renderDrone(0.031);
const airL = renderAir(1337), airR = renderAir(4242);
const rumL = renderRumble(909), rumR = renderRumble(717);
const dusL = renderDust(5150), dusR = renderDust(8080);
for (let n = 0; n < N; n++) {
  // the beds lean in when the room does
  const s = smooth((section(n / SR) - 0.35) / 0.65);
  const dg = 0.24 + 0.19 * s, rg = 0.10 + 0.11 * s;
  outL[n] += droL[n] * dg + airL[n] * 0.16 + rumL[n] * rg + dusL[n] * 0.030;
  outR[n] += droR[n] * dg + airR[n] * 0.16 + rumR[n] * rg + dusR[n] * 0.030;
}

// Kill DC and the inaudible sub that was eating all the headroom. Views onto
// the first N samples only — past N is spent tail that never gets written.
const loopL = outL.subarray(0, N), loopR = outR.subarray(0, N);
S.hpLoop(loopL, 26); S.hpLoop(loopL, 26);
S.hpLoop(loopR, 26); S.hpLoop(loopR, 26);

// gentle saturation, then normalise
const { peak, gain } = S.master(outL, outR);

// ------------------------------------------------------------- write wave

const outPath = process.argv[2] || path.join(__dirname, 'dungeon-crawl.wav');
const bytes = S.writeWav(outPath, outL, outR, gain);

console.log(`${outPath}  ${LEN}s  ${SR}Hz stereo  peak ${(peak * gain).toFixed(3)}  ${(bytes / 1048576).toFixed(1)} MB`);
