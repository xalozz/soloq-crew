# Música de tráiler sintetizada (sin samples), sincronizada con los golpes del vídeo.
import json, sys
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
from scipy.io import wavfile

SR = 48000
scenes = json.load(open(sys.argv[1]))
OUT = sys.argv[2]
starts, t0 = {}, 0.0
for s in scenes:
    starts[s['id']] = t0; t0 += s['dur']
TOTAL = t0
N = int(TOTAL * SR) + SR
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(7)

def tt(n): return np.arange(n) / SR
def at(sec): return int(sec * SR)
def add(sig, sec, pan=0.0, gain=1.0):
    i = at(sec); sig = sig[: max(0, N - i)]
    L[i:i + len(sig)] += sig * gain * (1 - max(0, pan))
    R[i:i + len(sig)] += sig * gain * (1 + min(0, pan))
def lp(x, f, o=2): return sosfilt(butter(o, f, 'low', fs=SR, output='sos'), x)
def hp(x, f, o=2): return sosfilt(butter(o, f, 'high', fs=SR, output='sos'), x)
def bp(x, a, b, o=2): return sosfilt(butter(o, [a, b], 'band', fs=SR, output='sos'), x)
def saw(f, n, det=0.0):
    ph = np.cumsum(np.full(n, f * (1 + det)) / SR)
    return 2 * (ph % 1) - 1
def note(name):
    names = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'Bb': 10, 'B': 11}
    return 440 * 2 ** ((names[name[:-1]] + 12 * (int(name[-1]) + 1) - 69) / 12)

def boom(dur=2.6, f0=90, f1=36, gain=1.0):
    n = int(dur * SR); t = tt(n)
    f = f1 + (f0 - f1) * np.exp(-t * 9)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.6)
    thump = lp(rng.standard_normal(n), 900) * np.exp(-t * 18) * .8
    click = hp(rng.standard_normal(n), 3000) * np.exp(-t * 90) * .25
    return np.tanh((body * 1.4 + thump + click) * 1.3) * gain

def braam(dur=4.0, root='D1', gain=1.0):
    n = int(dur * SR); t = tt(n)
    sig = np.zeros(n)
    for nm, g in [(root, 1.0), ('D2', .8), ('A2', .55), ('D3', .35), ('F3', .2)]:
        f = note(nm)
        for d in (-.006, 0, .007):
            sig += saw(f, n, d) * g
    env = np.minimum(1, t / .04) * np.exp(-t * .9)
    sig = lp(sig, 400 + 1400 * 0, 4) * env
    return np.tanh(sig * .9) * gain

def riser(dur=1.4, gain=.5):
    n = int(dur * SR); t = tt(n)
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    # barrido: la banda sube con el tiempo (por tramos)
    seg = 12
    for k in range(seg):
        a, b = k * n // seg, (k + 1) * n // seg
        fc = 300 * (12 ** (k / seg))
        out[a:b] = bp(noise, fc * .7, min(fc * 1.6, 20000))[a:b]
    tone = np.sin(2 * np.pi * np.cumsum(220 * 2 ** (2.5 * t / dur)) / SR) * .25
    env = (t / dur) ** 2.4
    return (out * .6 + tone) * env * gain

def pluck(f, dur=.32, gain=.3):
    n = int(dur * SR); t = tt(n)
    s = saw(f, n, -.004) + saw(f, n, .004) + .5 * saw(f / 2, n)
    s = lp(s, 1600, 2) * np.exp(-t * 11)
    return s * gain

def tick(gain=.08):
    n = int(.05 * SR); t = tt(n)
    return hp(rng.standard_normal(n), 6000) * np.exp(-t * 120) * gain

# ---------------------------------------------------------------- pad de fondo
n = N; t = tt(n)
pad = np.zeros(n)
for nm, g in [('D2', .5), ('A2', .35), ('D3', .2), ('F3', .12)]:
    for d in (-.004, .003):
        pad += saw(note(nm), n, d) * g
pad = lp(pad, 520, 2)
vol = np.full(n, .10)
def ramp(a, b, va, vb):
    i, j = at(a), at(b)
    vol[i:j] = np.linspace(va, vb, j - i)
ramp(0, 2.0, 0, .10)

# ---------------------------------------------------------------- intro
I = starts['intro']
add(boom(3.0, 70, 32, .55), I + 1.1)
add(braam(3.2, 'D1', .25), I + 1.1)
add(riser(1.6, .45), I + 6.5 - 1.6 + .25)

# ---------------------------------------------------------------- jugadores
STAT_AT, CLOSE_AT, PDUR = [2.4, 4.6, 6.8], 9.0, 11.0
BPM = 105; beat = 60 / BPM
pattern = ['D3', 'D3', 'D3', 'D3', 'F3', 'F3', 'E3', 'E3', 'D3', 'D3', 'D3', 'D3', 'Bb2', 'Bb2', 'A2', 'A2']
pids = [k for k in starts if k.startswith('p')]
for idx, pid in enumerate(pids):
    P = starts[pid]
    add(boom(2.8, 95, 34, 1.0), P + .25)
    add(braam(3.0, 'D1', .5), P + .25)
    for i, s in enumerate(STAT_AT):
        add(boom(2.2, 110, 40, .75 + .1 * i), P + s, gain=1.0)
    # ostinato desde el primer dato hasta justo antes de la frase final
    k = 0; x = P + STAT_AT[0] - beat * 4
    while x < P + CLOSE_AT - .3:
        nm = pattern[k % len(pattern)]
        add(pluck(note(nm), gain=.22 + .06 * (k % 2 == 0)), x, pan=-.2)
        add(pluck(note(nm) * 2, dur=.18, gain=.07), x, pan=.25)
        add(tick(), x + beat / 4, pan=.4); add(tick(.05), x + 3 * beat / 4, pan=-.4)
        k += 1; x += beat / 2
    # silencio seco para la frase final: el pad baja y entra un único golpe grave
    ramp(P + CLOSE_AT - .35, P + CLOSE_AT, .10, .025)
    ramp(P + CLOSE_AT, P + PDUR - .2, .025, .025)
    ramp(P + PDUR - .2, P + PDUR + .3, .025, .10)
    add(boom(3.5, 55, 30, .55), P + CLOSE_AT)
    nxt = P + PDUR + .25
    add(riser(1.5, .5), nxt - 1.5)

# ---------------------------------------------------------------- final
O = starts['outro']
add(braam(5.0, 'D1', .7), O + .2)
add(boom(4.0, 80, 28, 1.0), O + .2)
ramp(O + .2, TOTAL, .10, 0)

pad *= vol
L += pad; R += pad

# ---------------------------------------------------------------- reverb y máster
ir_n = int(2.2 * SR); irt = tt(ir_n)
irL = rng.standard_normal(ir_n) * np.exp(-irt * 3.2); irR = rng.standard_normal(ir_n) * np.exp(-irt * 3.2)
irL = lp(irL, 5000); irR = lp(irR, 5000)
wetL = fftconvolve(L, irL)[:N] * .018; wetR = fftconvolve(R, irR)[:N] * .018
L2, R2 = L + wetL, R + wetR
mix = np.stack([L2, R2], 1)[: int(TOTAL * SR)]
mix = np.tanh(mix * 1.1)
fade = int(.8 * SR); mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
mix /= np.max(np.abs(mix)) / .89
wavfile.write(OUT, SR, (mix * 32767).astype(np.int16))
print('ok', round(TOTAL, 2), 's')
