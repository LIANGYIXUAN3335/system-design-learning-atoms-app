#!/usr/bin/env python3
"""重新合成 assets/sfx 里的「叮」五级（G6 A6 B6 D7 E7，五声音阶，每个 120ms）。只用标准库。
用法：python3 scripts/make-sfx.py
fanfare.wav 不在这里生成（10/11 一次性合成的，没改过）。"""
import math, struct, wave, os
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'assets', 'sfx')
def synth(path, freq, ms=120, rate=44100, amp=0.55):
    n = int(rate * ms / 1000); frames = bytearray()
    for i in range(n):
        t = i / rate
        env = min(1.0, t / 0.004) * math.exp(-t * 28)
        v = amp * env * (math.sin(2 * math.pi * freq * t) + 0.25 * math.sin(2 * math.pi * freq * 2 * t))
        frames += struct.pack('<h', int(max(-1, min(1, v)) * 32767))
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(bytes(frames))
LADDER = [('ding-1', 1568.0), ('ding-2', 1760.0), ('ding-3', 1975.5), ('ding-4', 2349.3), ('ding-5', 2637.0)]
for name, f in LADDER:
    synth(os.path.join(OUT, name + '.wav'), f)
    print('wrote', name)
