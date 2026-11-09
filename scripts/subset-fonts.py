#!/usr/bin/env python3
"""Subset M PLUS Rounded 1c to the characters GeoGrasp actually uses (keeps the app small).
Usage: python3 scripts/subset-fonts.py   (needs fonttools: pip install fonttools)
GPL-3.0-or-later"""
import glob, os, subprocess
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
chars = set()
for f in glob.glob(os.path.join(ROOT, 'app/js/*.js')) + [os.path.join(ROOT, 'app/index.html'), os.path.join(ROOT, 'app/data/world.json')]:
    chars |= set(open(f, encoding='utf-8').read())
chars |= set(chr(c) for c in range(0x20, 0x7f)) | set('、。・ー「」『』（）！？：〜…　0123456789')
chars |= set(chr(c) for c in range(0x3040, 0x30ff))  # all hiragana + katakana
text = ''.join(sorted(chars))
for w in ('Medium', 'Bold'):
    src = os.path.join(ROOT, f'assets/fonts/MPLUSRounded1c-{w}.ttf')
    dst = os.path.join(ROOT, f'app/fonts/MPLUSRounded1c-{w}.subset.ttf')
    subprocess.run(['pyftsubset', src, f'--text={text}', f'--output-file={dst}', '--layout-features=*', '--no-hinting'], check=True)
    print(dst, os.path.getsize(dst) // 1024, 'KB')
