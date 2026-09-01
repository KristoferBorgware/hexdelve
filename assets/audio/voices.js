// voices.js — the things that live in the dungeon.
//
// These are the sound sources shared between the dungeon tracks: a throat, a
// pulse, claws, lungs, metal, water. They all write through one `place`
// function so a track can route them to whatever buses it has.
//
//   const V = require('./voices')({ S, place, rnd });

module.exports = function createVoices({ S, place, rnd }) {
  const { SR, N, NT, mtof, smooth, pan2, svf, svfState } = S;

  // The centrepiece. A buzzing larynx driven through a bank of formants, with
  // vocal fry chopping it — the roughness is what makes it read as an animal
  // and not as a synth pad.
  function growl(tStart, dur, baseHz, amp, panPos, send, echo = 0.25) {
    const start = Math.round(tStart * SR);
    if (start >= N) return;
    const total = Math.round(dur * SR);
    const [l, r] = pan2(panPos);
    const formants = [[235, 1.00], [590, 0.52], [1310, 0.20], [2550, 0.05]];
    const st = formants.map(svfState);
    const fseed = rnd() * 6.28;
    let ph = 0, fry = 0, sub = 0;
    for (let n = 0; n < total && start + n < NT; n++) {
      const x = n / total, t = n / SR;
      // the pitch never sits still
      const f = baseHz * (1 + 0.10 * Math.sin(2 * Math.PI * t * 0.31 + fseed)
                            + 0.05 * Math.sin(2 * Math.PI * t * 0.13 + 1.1));
      ph += f / SR; if (ph >= 1) ph -= 1;
      let src = 2 * ph - 1;
      src -= 0.45 * src * src * Math.sign(src);      // round off the saw
      src += (rnd() * 2 - 1) * 0.22;                 // breath in the throat
      // vocal fry: an irregular chop somewhere under 40 Hz
      fry += (26 + 9 * Math.sin(2 * Math.PI * t * 0.7 + fseed)) / SR;
      if (fry >= 1) fry -= 1;
      src *= 0.40 + 0.60 * Math.pow(1 - fry, 1.6);

      let out = 0;
      for (let k = 0; k < formants.length; k++) {
        const fc = formants[k][0] * (1 + 0.07 * Math.sin(2 * Math.PI * t * 0.23 + k));
        out += svf(st[k], src, fc, 0.16) * formants[k][1];
      }
      sub += 0.02 * (Math.sin(2 * Math.PI * f * 0.5 * t) * 0.5 - sub);  // chest
      const e = x < 0.16 ? smooth(x / 0.16) : smooth((1 - x) / 0.84);
      place(start + n, (out * 0.68 + sub) * amp * e, l, r, send, echo);
    }
  }

  // Not a drum — a pulse in your own ears. Two beats, the second softer.
  function heart(tStart, amp, panPos) {
    const [l, r] = pan2(panPos);
    const beat = (t0, a, tau) => {
      const start = Math.round(t0 * SR);
      const dur = Math.round(1.1 * SR);
      let ph = 0;
      for (let n = 0; n < dur && start + n < NT; n++) {
        const t = n / SR;
        ph += 2 * Math.PI * (29 + 34 * Math.exp(-t / 0.045)) / SR;
        place(start + n, Math.sin(ph) * Math.exp(-t / tau) * a, l, r, 0.3);
      }
    };
    beat(tStart, amp, 0.20);
    beat(tStart + 0.29, amp * 0.62, 0.16);
  }

  // One claw on one stone. A few milliseconds of resonant noise.
  function click(tStart, fc, amp, panPos, send) {
    const start = Math.round(tStart * SR);
    if (start < 0 || start >= N) return;
    const [l, r] = pan2(panPos);
    const dur = Math.round(0.05 * SR);
    const st = svfState();
    const tau = 0.003 + rnd() * 0.006;
    for (let n = 0; n < dur && start + n < NT; n++) {
      const v = svf(st, rnd() * 2 - 1, fc, 0.10);
      place(start + n, v * amp * Math.exp(-(n / SR) / tau), l, r, send);
    }
  }

  // Many of them, moving. Clustered towards the start of the burst so it reads
  // as a scurry rather than as a shaker.
  function skitter(tStart, dur, count, amp, spread, send) {
    for (let i = 0; i < count; i++) {
      const t = tStart + Math.pow(rnd(), 1.4) * dur;
      click(t, 1900 + rnd() * 4200, amp * (0.35 + rnd() * 0.65),
            (rnd() * 2 - 1) * spread, send);
    }
  }

  // Water. The bubble left in the puddle does ring, and it does rise in pitch
  // as it shrinks — but synthesising that as a clean sine with a big glide
  // gives you a science-fiction bloop, not a cave. What actually carries a
  // drip is a struck resonance: a broadband tick that rings briefly at one
  // pitch and dies inside a twentieth of a second. The glide stays, but small
  // enough to read as texture rather than as a swoop.
  // A single razor-sharp resonator rings as a sine, which is the bloop again.
  // A real drop excites a small cavity with several inharmonic modes at once,
  // and the modes are broad — so most of what you hear is still the strike.
  const MODES = [[1.00, 0.075, 1.00], [1.79, 0.130, 0.40], [2.63, 0.210, 0.18]];
  function drip(tStart, f0, amp, panPos, send, echo = 0.28) {
    const start = Math.round(tStart * SR);
    if (start < 0 || start >= N) return;
    const [l, r] = pan2(panPos);
    const dur = Math.round(0.26 * SR);
    const tau = 0.019 + rnd() * 0.026;          // 19-45 ms, and that is all
    const rise = 1.04 + rnd() * 0.10;           // barely glides
    const chirp = 0.004 + rnd() * 0.005;
    const exc = Math.round((0.0025 + rnd() * 0.0035) * SR);  // the strike
    const st = MODES.map(svfState);
    const tickSt = svfState();
    for (let n = 0; n < dur && start + n < NT; n++) {
      const t = n / SR;
      const f = f0 * (1 + (rise - 1) * (1 - Math.exp(-t / chirp)));
      const drive = n < exc ? rnd() * 2 - 1 : 0;
      let v = 0;
      for (let k = 0; k < MODES.length; k++) {
        v += svf(st[k], drive, f * MODES[k][0], MODES[k][1]) * MODES[k][2];
      }
      // the surface breaking: wide, and over almost at once
      v += svf(tickSt, drive, f * 3.5, 0.50) * 0.40 * Math.exp(-t / 0.0022);
      place(start + n, v * amp * Math.exp(-t / tau), l, r, send, echo);
    }
  }

  // A dripping cave never drips in time. Each source has its own rough period
  // and its own pitch, and they drift against each other. Past `fadeFrom` both
  // the level and the density taper, so the water can leave the room without
  // stopping dead.
  function dripField(tStart, tEnd, sources, amp, send, fadeFrom = tEnd) {
    for (let s = 0; s < sources; s++) {
      const f0 = 760 + rnd() * 1850;
      const period = 1.6 + rnd() * 5.5;
      const panPos = (rnd() * 2 - 1) * 0.9;
      const gain = amp * (0.35 + rnd() * 0.75);
      let t = tStart + rnd() * period;
      while (t < tEnd) {
        const x = t <= fadeFrom ? 1 : Math.max(0, 1 - (t - fadeFrom) / (tEnd - fadeFrom));
        if (x > 0.02) drip(t, f0 * (0.94 + rnd() * 0.12), gain * (0.7 + rnd() * 0.5) * x * x, panPos, send);
        t += period * (0.7 + rnd() * 0.6) / Math.max(0.25, x);   // and thins out
      }
    }
  }

  // Something with lungs, close enough to hear. In, pause, out, pause.
  function breath(tStart, cycles, period, amp, panPos) {
    const [l, r] = pan2(panPos);
    for (let c = 0; c < cycles; c++) {
      const t0 = tStart + c * period;
      for (const [off, len, f0, f1, g] of [[0, period * 0.30, 340, 780, 1.0],
                                           [period * 0.44, period * 0.36, 700, 300, 0.85]]) {
        const start = Math.round((t0 + off) * SR);
        if (start >= N) continue;
        const total = Math.round(len * SR);
        const st = svfState();
        for (let n = 0; n < total && start + n < NT; n++) {
          const x = n / total;
          const v = svf(st, rnd() * 2 - 1, f0 * Math.pow(f1 / f0, x), 0.55);
          const e = Math.sin(Math.PI * x);
          place(start + n, v * amp * g * e * e, l, r, 0.55, 0.15);
        }
      }
    }
  }

  // A struck cluster. Adjacent semitones, hit at once, left to ring out.
  function stab(tStart, midis, amp, send) {
    midis.forEach((midi, k) => {
      const start = Math.round(tStart * SR);
      if (start >= N) return;
      const f = mtof(midi) * (1 + (rnd() - 0.5) * 0.004);
      const [l, r] = pan2((k / Math.max(1, midis.length - 1)) * 1.4 - 0.7);
      const dur = Math.round(7 * SR);
      const tau = 1.6 + rnd() * 1.4;
      for (let n = 0; n < dur && start + n < NT; n++) {
        const t = n / SR;
        const atk = 1 - Math.exp(-t / 0.006);
        const s = Math.sin(2 * Math.PI * f * t)
                + 0.34 * Math.sin(2 * Math.PI * f * 2 * t + 1)
                + 0.16 * Math.sin(2 * Math.PI * f * 3.02 * t + 2)
                + 0.07 * Math.sin(2 * Math.PI * f * 4.97 * t);
        place(start + n, s * amp * atk * Math.exp(-t / tau), l, r, send, 0.3);
      }
    });
  }

  // Tension with nowhere to go. Noise and a detuned cluster climbing an octave,
  // then cut — whatever lands next has to carry it.
  function riser(tStart, dur, amp, send, baseMidi = 49) {
    const start = Math.round(tStart * SR);
    if (start >= N) return;
    const total = Math.round(dur * SR);
    const st = svfState(), st2 = svfState();
    const base = mtof(baseMidi);
    const phs = [0, 0, 0], dets = [1, 1.006, 0.993];
    for (let n = 0; n < total && start + n < NT; n++) {
      const x = n / total;
      const rise = Math.pow(2, x);
      const noise = svf(st, rnd() * 2 - 1, 220 * Math.pow(9, x), 0.30) * 0.6
                  + svf(st2, rnd() * 2 - 1, 900 * Math.pow(5, x), 0.45) * 0.3;
      let saws = 0;
      for (let k = 0; k < 3; k++) {
        phs[k] += base * dets[k] * rise / SR;
        if (phs[k] >= 1) phs[k] -= 1;
        saws += (2 * phs[k] - 1) * 0.22;
      }
      const e = Math.pow(x, 2.2) * (n > total - 0.015 * SR ? (total - n) / (0.015 * SR) : 1);
      const pos = Math.sin(2 * Math.PI * x * 1.5) * 0.5;
      const [l, r] = pan2(pos);
      place(start + n, (noise + saws) * amp * e, l, r, send, 0.2);
    }
  }

  // Links, dragged. Irregular metallic ticks over a scraping band of noise.
  function chain(tStart, dur, amp, panPos) {
    const start = Math.round(tStart * SR);
    if (start >= N) return;
    const total = Math.round(dur * SR);
    const [l, r] = pan2(panPos);
    const st = svfState();
    for (let n = 0; n < total && start + n < NT; n++) {
      const x = n / total;
      const v = svf(st, rnd() * 2 - 1, 300 + 900 * Math.sin(Math.PI * x), 0.22);
      place(start + n, v * amp * Math.sin(Math.PI * x) * 0.5, l, r, 0.85, 0.25);
    }
    // the links themselves
    let t = tStart;
    while (t < tStart + dur) {
      click(t, 2400 + rnd() * 2600, amp * (0.5 + rnd() * 0.8), panPos + (rnd() - 0.5) * 0.3, 0.9);
      t += 0.05 + Math.pow(rnd(), 2) * 0.4;
    }
  }

  // A muted, plucked string, damped almost to death.
  function pluck(tStart, midi, amp, panPos, send, damp = 0.9985, bright = 0.14) {
    const start = Math.round(tStart * SR);
    if (start >= N) return;
    const M = Math.max(2, Math.round(SR / mtof(midi)));
    const buf = new Float32Array(M);
    let lp = 0;
    for (let i = 0; i < M; i++) { lp += bright * ((rnd() * 2 - 1) - lp); buf[i] = lp; }
    let dc = 0;
    for (let i = 0; i < M; i++) dc += buf[i];
    dc /= M;
    let pk = 0;
    for (let i = 0; i < M; i++) { buf[i] -= dc; pk = Math.max(pk, Math.abs(buf[i])); }
    if (pk > 0) for (let i = 0; i < M; i++) buf[i] /= pk;

    const [l, r] = pan2(panPos);
    const dur = Math.min(NT - start, Math.round(10 * SR));
    let idx = 0;
    for (let n = 0; n < dur; n++) {
      const cur = buf[idx];
      buf[idx] = damp * 0.5 * (cur + buf[(idx + 1) % M]);
      idx = idx + 1 === M ? 0 : idx + 1;
      const fade = n < dur - SR ? 1 : (dur - n) / SR;
      place(start + n, cur * amp * fade, l, r, send, 0.35);
    }
  }

  return { growl, heart, click, skitter, drip, dripField, breath, stab, riser, chain, pluck };
};
