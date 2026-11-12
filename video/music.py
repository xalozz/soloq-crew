# Banda sonora: música de tráiler sintetizada + sonidos y voces de campeones, sincronizada con spec.json
# uso: python music.py spec.json out/music.wav
import json, sys, os, subprocess, tempfile
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
from scipy.io import wavfile

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
spec = json.load(open(sys.argv[1], encoding='utf-8'))
OUT = sys.argv[2]
cast = spec['cast']
starts, t0 = {}, 0.0
for sid, dur in [('intro', spec['intro']['dur'])] + [(f'p{i}', p['dur']) for i, p in enumerate(cast)] + [('finale', spec['finale']['dur'])]:
    starts[sid] = t0; t0 += dur
TOTAL = t0
N = int(TOTAL * SR) + SR
M = np.zeros((N, 2))      # música y efectos
V = np.zeros((N, 2))      # voces
duck = np.ones(N)
rng = np.random.default_rng(7)

def tt(n): return np.arange(n) / SR
def at(sec): return int(max(0, sec) * SR)
def add(sig, sec, pan=0.0, gain=1.0, bus=M):
    i = at(sec); sig = sig[: max(0, N - i)]
    if sig.ndim == 1:
        bus[i:i + len(sig), 0] += sig * gain * (1 - max(0, pan)); bus[i:i + len(sig), 1] += sig * gain * (1 + min(0, pan))
    else:
        bus[i:i + len(sig)] += sig * gain
def lp(x, f, o=2): return sosfilt(butter(o, f, 'low', fs=SR, output='sos'), x)
def hp(x, f, o=2): return sosfilt(butter(o, f, 'high', fs=SR, output='sos'), x)
def bp(x, a, b, o=2): return sosfilt(butter(o, [a, b], 'band', fs=SR, output='sos'), x)
def saw(f, n, det=0.0): return 2 * ((np.cumsum(np.full(n, f * (1 + det)) / SR)) % 1) - 1
def note(name):
    names = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'Bb': 10, 'B': 11}
    return 440 * 2 ** ((names[name[:-1]] + 12 * (int(name[-1]) + 1) - 69) / 12)

def boom(dur=2.6, f0=90, f1=36, gain=1.0):
    n = int(dur * SR); t = tt(n)
    f = f1 + (f0 - f1) * np.exp(-t * 9)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * (4.2 / dur + .6))
    thump = lp(rng.standard_normal(n), 900) * np.exp(-t * 18) * .8
    click = hp(rng.standard_normal(n), 3000) * np.exp(-t * 90) * .25
    return np.tanh((body * 1.4 + thump + click) * 1.3) * gain
def braam(dur=3.0, gain=1.0):
    n = int(dur * SR); t = tt(n); sig = np.zeros(n)
    for nm, g in [('D1', 1.0), ('D2', .8), ('A2', .55), ('D3', .35), ('F3', .2)]:
        for d in (-.006, 0, .007): sig += saw(note(nm), n, d) * g
    return np.tanh(lp(sig, 420, 4) * np.minimum(1, t / .04) * np.exp(-t * 1.1) * .9) * gain
def riser(dur=1.4, gain=.5):
    n = int(dur * SR); t = tt(n); noise = rng.standard_normal(n); out = np.zeros(n); seg = 12
    for k in range(seg):
        a, b = k * n // seg, (k + 1) * n // seg; fc = 300 * (12 ** (k / seg))
        out[a:b] = bp(noise, fc * .7, min(fc * 1.6, 20000))[a:b]
    tone = np.sin(2 * np.pi * np.cumsum(220 * 2 ** (2.5 * t / dur)) / SR) * .25
    return (out * .6 + tone) * (t / dur) ** 2.4 * gain
def pluck(f, dur=.3, gain=.3):
    n = int(dur * SR); t = tt(n)
    return lp(saw(f, n, -.004) + saw(f, n, .004) + .5 * saw(f / 2, n), 1700) * np.exp(-t * 12) * gain
def hat(gain=.07, dec=120):
    n = int(.06 * SR); return hp(rng.standard_normal(n), 7000) * np.exp(-tt(n) * dec) * gain
def thud(f=110, gain=.5):
    n = int(.22 * SR); t = tt(n)
    return (np.sin(2 * np.pi * np.cumsum(f * .5 + f * np.exp(-t * 30)) / SR) * np.exp(-t * 20) + lp(rng.standard_normal(n), 2500) * np.exp(-t * 60) * .5) * gain
def snare(gain=.4):
    n = int(.25 * SR); t = tt(n)
    return (bp(rng.standard_normal(n), 900, 7000) * np.exp(-t * 22) + np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30) * .6) * gain
def blip(f1=1318, f2=1760, gain=.16):
    n = int(.16 * SR); t = tt(n); h = n // 2
    s = np.concatenate([np.sin(2 * np.pi * f1 * t[:h]), np.sin(2 * np.pi * f2 * t[:n - h])])
    return s * np.exp(-t * 16) * gain
def coin(gain=.13):
    n = int(.25 * SR); t = tt(n); f = 2200 + rng.random() * 1400
    return (np.sin(2 * np.pi * f * t) + .5 * np.sin(2 * np.pi * f * 1.5 * t)) * np.exp(-t * 22) * gain
def clang(gain=.5):
    n = int(1.4 * SR); t = tt(n)
    return sum(np.sin(2 * np.pi * f * t) * np.exp(-t * d) for f, d in [(311, 4), (523, 5), (839, 7), (1251, 9), (1873, 12)]) * gain / 3
def whoosh(dur=.7, gain=.5):
    n = int(dur * SR); t = tt(n); x = rng.standard_normal(n); out = np.zeros(n); seg = 8
    for k in range(seg):
        a, b = k * n // seg, (k + 1) * n // seg; fc = 500 + 5000 * np.sin(np.pi * (k + .5) / seg)
        out[a:b] = bp(x, fc * .6, fc * 1.5)[a:b]
    return out * np.sin(np.pi * t / dur) ** 2 * gain
def shot(gain=.9):
    n = int(.9 * SR); t = tt(n)
    return np.tanh((rng.standard_normal(n) * np.exp(-t * 14) + lp(rng.standard_normal(n), 300) * np.exp(-t * 5) * 2) * 2) * gain
def shimmer(gain=.2):
    n = int(1.2 * SR); t = tt(n)
    return sum(np.sin(2 * np.pi * f * t) for f in (1174, 1760, 2349, 2960)) * np.sin(np.pi * t / 1.2) ** 2 * gain / 4

def load(path, peak):
    tmp = os.path.join(tempfile.gettempdir(), 'soloq_' + os.path.basename(os.path.dirname(path)) + '_' + os.path.basename(path) + '.wav')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', path, '-ar', str(SR), '-ac', '2', tmp], check=True)
    _, x = wavfile.read(tmp); x = x.astype(float) / 32768
    return x / (np.max(np.abs(x)) + 1e-9) * peak
def cut(x, dur, fade=.25):
    n = min(len(x), int(dur * SR)); x = x[:n].copy(); f = min(n, int(fade * SR))
    x[-f:] *= np.linspace(1, 0, f)[:, None] if x.ndim == 2 else np.linspace(1, 0, f)
    return x

# ---------------------------------------------------------------- pad de fondo
pad = np.zeros(N)
for nm, g in [('D2', .5), ('A2', .35), ('D3', .2), ('F3', .12)]:
    for d in (-.004, .003): pad += saw(note(nm), N, d) * g
pad = lp(pad, 520)
vol = np.full(N, .09)
def ramp(a, b, va, vb):
    i, j = at(a), min(N, at(b))
    if j > i: vol[i:j] = np.linspace(va, vb, j - i)
ramp(0, 1.5, 0, .09)

# ---------------------------------------------------------------- intro
I = starts['intro']
for k, x in enumerate([1.0, 1.55, 2.0, 2.35, 2.62]):
    add(thud(90 + k * 12, .7), I + x); add(hp(rng.standard_normal(int(.08 * SR)), 2000) * .25, I + x, pan=(-1) ** k * .4)
add(riser(2.0, .55), I + 1.0)
add(boom(3.2, 80, 32, 1.0), I + 3.0); add(braam(3.6, .7), I + 3.0)
for x in (4.1, 5.3): add(thud(70, .45), I + x)

# ---------------------------------------------------------------- jugadores
BPM = 126; step = 60 / BPM / 4   # semicorcheas
PAT = ['D3', None, 'D3', 'D3', None, 'D3', 'F3', None, 'D3', None, 'D3', 'D3', 'E3', None, 'C3', 'D3']
for idx, p in enumerate(cast):
    P = starts[f'p{idx}']; C = p['closeAt']
    add(riser(1.5, .5), P + .5 - 1.5)
    add(boom(2.8, 95, 34, 1.0), P + .5); add(braam(2.6, .55), P + .5); add(snare(.5), P + .5)
    # ostinato + platos desde el golpe de entrada hasta la frase final
    k = 0; x = P + .5 + step * 8
    while x < P + C - .25:
        nm = PAT[k % 16]; drive = min(1.0, .55 + (x - P) / C * .6)
        if nm: add(pluck(note(nm), gain=.2 * drive), x, pan=-.25); add(pluck(note(nm) * 2, dur=.16, gain=.06 * drive), x, pan=.3)
        if k % 2 == 0: add(hat(.05 * drive), x, pan=.35)
        if k % 4 == 2: add(hat(.09 * drive, 60), x, pan=-.35)
        if k % 8 == 0 and x > P + 2.4: add(thud(62, .42 * drive), x)
        if k % 8 == 4 and x > P + 2.4: add(snare(.2 * drive), x)
        k += 1; x += step
    for s in p['stats']:
        A = P + s['at']; g = s['gag']
        add(boom(2.0, 110, 42, .8), A)
        if s.get('sfx'): add(cut(load(os.path.join(HERE, 'assets', 'sfx', s['champ'] + '.ogg'), .5), s['dur'] - .1), A + .05)
        if s.get('vo'):
            v = load(os.path.join(HERE, 'assets', 'vo', s['champ'] + '.ogg'), .95); vs = A + .45
            add(v, vs, bus=V)
            i, j = at(vs - .15), at(vs + len(v) / SR + .2); r = int(.15 * SR)
            duck[i:j] = .38; duck[i:i + r] = np.linspace(1, .38, r); duck[j - r:j] = np.linspace(.38, 1, r)
        if g == 'stamps':
            for i in range(s['count']): add(thud(120 - i * 3, .75), A + .3 + i * .13, pan=(-1) ** i * .2); add(hat(.12, 80), A + .3 + i * .13)
        elif g == 'deaths':
            for i in range(s['deaths']): add(thud(170, .4), A + .45 + i * .1); add(hat(.1, 90), A + .45 + i * .1)
        elif g == 'gold':
            for i in range(26): add(coin(), A + .9 + rng.random() * 1.2, pan=rng.random() - .5)
        elif g == 'reflect': add(shimmer(.35), A + .75); add(clang(.25), A + .8)
        elif g == 'slash': add(whoosh(.6, .9), A + .6); add(boom(2.4, 140, 38, .9), A + .95); add(clang(.3), A + .95)
        elif g == 'chart': add(riser(1.6, .3)[::-1].copy(), A + .3)
        elif g == 'crosshair': add(blip(880, 880, .12), A + .8); add(shot(.8), A + 1.0); add(boom(2.0, 120, 40, .8), A + 1.0)
        elif g == 'crack':
            for i in range(s['deaths']): add(hp(rng.standard_normal(int(.07 * SR)), 2500) * np.exp(-tt(int(.07 * SR)) * 60) * .5, A + .4 + i * .14, pan=(-1) ** i * .3)
            add(boom(2.2, 130, 40, .9), A + .4 + s['deaths'] * .14); add(clang(.3), A + .4 + s['deaths'] * .14)
        elif g == 'hammer': add(whoosh(.4, .5), A + .5); add(boom(2.8, 150, 34, 1.1), A + .9); add(clang(.75), A + .9)
        elif g == 'flag': add(whoosh(1.0, .25), A + .2)
        elif g == 'pings':
            for i in range(64): add(blip(*[(1318, 1760), (988, 784), (1568, 2093)][i % 3], gain=.13), A + .25 + i * .036, pan=rng.random() * 1.2 - .6)
        elif g == 'questions':
            for i in range(14): add(blip(784, 1046, .12), A + .2 + i * .17, pan=(-1) ** i * .4)
        elif g == 'spheres':
            for i in range(3): add(whoosh(.35, .4), A + .4 + i * .16); add(boom(1.8, 130, 44, .85), A + .75 + i * .16)
    # frase final en seco: baja el fondo y queda un único golpe grave
    ramp(P + C - .3, P + C, .09, .02); ramp(P + C, P + p['dur'] - .2, .02, .02); ramp(P + p['dur'] - .2, P + p['dur'] + .3, .02, .09)
    add(boom(3.2, 55, 30, .55), P + C + .15)
    if p.get('closing2'): add(boom(2.6, 60, 30, .6), P + C + 1.9)

# ---------------------------------------------------------------- final
F = starts['finale']; nc = len(cast)
add(riser(1.5, .5), F + .3 - 1.5)
for i in range(nc): add(snare(.5), F + .3 + i * .34); add(thud(80 + i * 10, .8), F + .3 + i * .34); add(pluck(note('D3') * 2 ** (i / 12), gain=.3), F + .3 + i * .34)
LINES = .3 + nc * .34 + .25; LAST = LINES + len(spec['finale']['lines']) * 1.25 + .35
for i in range(len(spec['finale']['lines'])): add(boom(2.2, 100, 38, .85), F + LINES + i * 1.25)
add(riser(1.2, .55), F + LAST - 1.2)
add(boom(4.5, 85, 28, 1.1), F + LAST); add(braam(5.0, .8), F + LAST); add(snare(.5), F + LAST)
ramp(F + LAST, TOTAL, .09, 0)

M[:, 0] += pad * vol; M[:, 1] += pad * vol

# ---------------------------------------------------------------- reverb, mezcla y máster
ir_n = int(2.0 * SR); irt = tt(ir_n)
for ch in (0, 1):
    ir = lp(rng.standard_normal(ir_n) * np.exp(-irt * 3.4), 5000)
    M[:, ch] += fftconvolve(M[:, ch], ir)[:N] * .016
    V[:, ch] += fftconvolve(V[:, ch], ir)[:N] * .006
mix = (np.tanh(M * 1.05) * duck[:, None] + V)[: int(TOTAL * SR)]
mix = np.tanh(mix)
fade = int(1.0 * SR); mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
mix /= np.max(np.abs(mix)) / .89
wavfile.write(OUT, SR, (mix * 32767).astype(np.int16))
print('ok', round(TOTAL, 2), 's')
