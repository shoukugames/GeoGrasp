#!/usr/bin/env python3
"""GeoGrasp voice generator.

Renders every spoken line (English + Japanese) with the Kokoro-82M neural voice
model (Apache-2.0) into small Ogg/Opus clips under app/voice/<lang>/<key>.ogg.

Real human recordings can replace any clip: just drop a file with the same
name into app/voice/<lang>/ — the game plays whatever file is there.

Usage:
  KOKORO_MODEL=kokoro-v1.0.onnx KOKORO_VOICES=voices-v1.0.bin \
  python gen-voice.py [--only en|ja] [--force]

Requires: kokoro-onnx, misaki[ja] (pyopenjtalk), soundfile, ffmpeg on PATH and
piper-tts (only for its bundled espeak-ng phonemizer, used for English).

Copyright (C) 2026 Shawn Rapaz — GPL-3.0-or-later
"""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile

import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'app', 'voice')
EN_VOICE = os.environ.get('EN_VOICE', 'af_heart')
JA_VOICE = os.environ.get('JA_VOICE', 'jf_alpha')

PHRASES = {
    'welcome':  ("Welcome to GeoGrasp! Let's explore the world together!", 'ジオグラスプへようこそ！いっしょに世界を旅しよう！'),
    'great1':   ('Great job!', 'よくできました！'),
    'great2':   ('Awesome!', 'すごいね！'),
    'great3':   ('Perfect!', 'パーフェクト！'),
    'try':      ('Oops! Try again.', 'おしい！もういちど。'),
    'timeup':   ("Time's up! Here is the right place.", 'じかんぎれ！せいかいはここだよ。'),
    'complete': ('Amazing! You completed the map!', 'すごい！地図がかんせいしたよ！'),
    'pick':     ('Pick up a puzzle piece!', 'パズルのピースをとってね！'),
    'pinch':    ('Pinch your fingers together to grab a piece, and open them to drop it.', 'ゆびをつまんでピースをつかんで、ひらいておいてね。'),
    'hand':     ('Show me your hand!', '手を見せてね！'),
    'cap_ok':   ('Correct!', 'せいかい！'),
    'explore':  ('Touch any country to learn about it.', '国にさわって、しらべてみよう。'),
    'goodbye':  ('See you next time!', 'またね！'),
}


def load_espeak():
    """Load piper's bundled espeak bridge directly (avoids importing piper)."""
    pdir = os.environ.get('PIPER_DIR')
    if not pdir:
        import piper  # only used to locate the package directory
        pdir = os.path.dirname(piper.__file__)
    spec = importlib.util.spec_from_file_location('espeakbridge', os.path.join(pdir, 'espeakbridge.so'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.initialize(os.path.join(pdir, 'espeak-ng-data'))
    mod.set_voice('en-us')
    return mod


def main():
    only = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else None
    force = '--force' in sys.argv
    lines = json.load(open(os.path.join(ROOT, 'data', 'voice-lines.json'), encoding='utf-8'))

    jobs = {'en': {}, 'ja': {}}
    for k, (en, ja) in PHRASES.items():
        jobs['en'][k] = en
        jobs['ja'][k] = ja
    for c in lines['countries']:
        k = c['key']
        jobs['en'][f'n_{k}'] = c['en'] + '!'
        jobs['ja'][f'n_{k}'] = c['ja'] + '！'
        jobs['en'][f'f_{k}'] = f"Find {c['en']}!"
        jobs['ja'][f'f_{k}'] = f"{c['ja']}は、どこかな？"
        if c['capEn']:
            jobs['en'][f'c_{k}'] = f"The capital city is {c['capEn']}. Which country is it?"
            jobs['ja'][f'c_{k}'] = f"首都は、{c['capJa']}。どこの国かな？"
            jobs['en'][f't_{k}'] = f"{c['en']}. The capital city is {c['capEn']}."
            jobs['ja'][f't_{k}'] = f"{c['ja']}。首都は、{c['capJa']}です。"
    for c in lines['continents']:
        k = c['key']
        jobs['en'][f'n_{k}'] = c['en'] + '!'
        jobs['ja'][f'n_{k}'] = c['ja'] + '！'
        jobs['en'][f'f_{k}'] = f"Find {c['en']}!"
        jobs['ja'][f'f_{k}'] = f"{c['ja']}は、どこかな？"

    kokoro = Kokoro(os.environ['KOKORO_MODEL'], os.environ['KOKORO_VOICES'])
    espeak = load_espeak() if only != 'ja' else None
    g2p = None
    if only != 'en':
        from misaki import ja
        g2p = ja.JAG2P()

    vocab = kokoro.tokenizer.vocab
    tmp = tempfile.mkdtemp()
    for lang in ('en', 'ja'):
        if only and only != lang:
            continue
        os.makedirs(os.path.join(OUT, lang), exist_ok=True)
        items = sorted(jobs[lang].items())
        for i, (key, text) in enumerate(items):
            dst = os.path.join(OUT, lang, key + '.ogg')
            if os.path.exists(dst) and not force:
                continue
            if lang == 'en':
                parts = espeak.get_phonemes(text)
                ph = ' '.join(p + punct for p, punct, _ in parts)
                voice, speed = EN_VOICE, 0.92
            else:
                ph, _ = g2p(text)
                voice, speed = JA_VOICE, 0.9
            ph = ''.join(ch for ch in ph if ch in vocab).strip()
            audio, sr = kokoro.create(ph, voice=voice, speed=speed, is_phonemes=True)
            wav = os.path.join(tmp, 'x.wav')
            sf.write(wav, audio, sr)
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', wav,
                            '-af', 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,apad=pad_dur=0.08,loudnorm=I=-16:TP=-1.5',
                            '-ar', '24000', '-ac', '1', '-c:a', 'libopus', '-b:a', '40k', dst], check=True)
            print(f'[{lang} {i + 1}/{len(items)}] {key}: {text}', flush=True)


if __name__ == '__main__':
    main()
