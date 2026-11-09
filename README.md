# GeoGrasp 🌍✋🧩

**Grab the world with your hands!** — *手で せかいを つかもう！*

GeoGrasp is a world-geography puzzle game for children (**recommended for ages 6+**). Using the
device's video camera, GeoGrasp follows the player's hand so they can **pinch** a puzzle piece shaped
like a country, carry it through the air and drop it in the right place on the world map. Every
country and capital is spoken aloud in a natural voice, in **English and Japanese**.

- Version: **v0.1.1** (released 2026-11-09)
- Created by **Shawn Rapaz** with **Claude Code**
- Website: <https://shoukugames.org/> · Email: <info@shoukugames.org>
- License: **GNU GPL v3.0** (see [LICENSE](LICENSE))

---

## Features

| | |
|---|---|
| ✋ **Hand tracking** | Pinch 🤏 to grab, open your hand ✋ to drop, hold still to point. Pinching over a button presses it. |
| 🖱️ **Mouse substitute** | If the camera isn't allowed (or there is no camera) the whole game is played with the mouse / touchpad. |
| 🟢 **Easy** | Pick any country piece from the tray on the right and put it in its place until the map is complete. When a piece is placed correctly its name is **spoken** and **printed at the top** of the screen. |
| 🟠 **Medium** | Voice only: the game *says* a country name — find the right piece among several and place it. |
| 🔴 **Hard** | Place the seven **continents** on an empty world map. |
| 🏛️ **Capital Cities** | The game says a capital city; point to the country it belongs to. |
| ⏱️ **120-second timer** | Every piece / question has its own 120 s countdown. Hints appear after repeated mistakes. |
| 🗺️ **Map regions** | World, Africa, Asia, Europe, North America, South America, Oceania (Easy, Medium, Capitals, Tutorial). |
| 📖 **Tutorial** | A world explorer: every country with its **capital city** (★ on the map) and **national flag**. |
| 👪 **For Parents** | Time played, games played, scores, accuracy, what was right / wrong in every game, "needs practice" list. Protected by a grown-up check. |
| 🗣️ **Natural voice** | Recorded voice lines for every country, capital and continent in English and Japanese. |
| 🎵 **Relaxing music** | Generative ambient soundtrack (soft pads, bells and ocean waves) plus gentle sound effects. |
| 🇯🇵 **English / 日本語** | Switch language at any time from the title screen. |

## Privacy & the camera 🔒

- GeoGrasp **always starts in mouse mode** — nobody is asked anything at startup and children can
  start playing straight away with the mouse / touchpad.
- The camera is only requested when the player chooses **Control → ✋ Hands (camera)** on the title
  screen. Then a parent / guardian must pass a grown-up check and tap **"OK — allow camera"**. If
  they cancel or choose "Don't allow", the game simply stays on the mouse. Parents can change the
  permission at any time in **For Parents**.
- The video camera is **100% offline**. Every frame is analysed in memory on this computer and then
  discarded. **Nothing is recorded, saved or sent anywhere.** Only video is requested — never the microphone.
- The camera **shuts off as soon as the game is closed** (and when you switch Control to *Mouse*).
- GeoGrasp makes **no network connections at all** — the app blocks every request that is not part of
  the game itself. No ads, no accounts, no analytics.
- Progress for the parents' dashboard is stored only on this computer.

## Install

### Linux (Debian / Ubuntu) — `.deb`

```bash
sudo apt install ./geograsp_0.1.1_amd64.deb
geograsp            # or launch "GeoGrasp" from the applications menu
```

Uninstall with `sudo apt remove geograsp`.

### Windows — `.exe`

- **`GeoGrasp-Setup-0.1.1.exe`** — installer (Start-menu & desktop shortcuts, uninstaller).
- **`GeoGrasp-0.1.1-portable.exe`** — runs without installing.

> The Windows builds are not code-signed yet, so SmartScreen may show *"Windows protected your PC"*.
> Click **More info → Run anyway**.

## How to play

1. Choose **English** or **日本語** (top right).
2. Pick a **difficulty** (Easy / Medium / Hard) and a **map**, then press **▶ Play**.
3. **With the mouse (default):** click and drag a piece onto the map — no setup needed.
   **To use your hands instead:** choose **Control → ✋ Hands (camera)** on the title screen; a grown-up
   answers a quick question and allows the camera.
   **With the camera:** hold your hand up so the little preview shows it. Move the white circle over a
   piece, **pinch** your thumb and index finger together to grab it, move it over the map and **open
   your hand** to drop it.
4. In **Capital Cities**, point at a country and hold still for a moment (or pinch / click).
5. Press **🔊** (or `R`) to hear the voice again, `Esc` to pause, `F11` for fullscreen.

## Building from source

Requirements: **Node.js 18+** (22 recommended). Python 3 is only needed to regenerate fonts or voices.

```bash
npm install          # also runs `npm run build:data` (map data, flags, offline vendor files)
npm start            # run the game
```

### Release packages

```bash
npm run dist:linux   # dist/geograsp_0.1.1_amd64.deb
npm run dist:win     # dist/GeoGrasp-Setup-0.1.1.exe + dist/GeoGrasp-0.1.1-portable.exe (needs Wine on Linux)
npm run dist         # both
```

### Regenerating assets (optional)

| Command | What it does |
|---|---|
| `npm run build:data` | Builds `app/data/world.json` from Natural Earth (world-atlas), world-countries and the Wikidata capitals snapshot in `data/`; copies flags, d3, MediaPipe WASM and the hand model into `app/`. Manual fixes live in `data/overrides.json`. |
| `npm run build:fonts` | Subsets *M PLUS Rounded 1c* to the Japanese characters the game uses (needs `fonttools`). |
| `npm run build:voice` | Renders every voice line with the Kokoro-82M voice model into `app/voice/<lang>/*.ogg`. See the header of `scripts/gen-voice.py` for requirements. |

**Using real human recordings:** every voice clip is a small file in `app/voice/en/` or
`app/voice/ja/` (e.g. `n_JPN.ogg` = "Japan!", `f_JPN.ogg` = "Find Japan!", `c_JPN.ogg` = capital
question, `t_JPN.ogg` = "Japan. The capital city is Tokyo."). Record a file with the same name
(Ogg Opus or Ogg Vorbis, mono is fine) and drop it in to replace the generated voice.

## Project layout

```
electron/        Electron main process (offline protocol, camera permission, window)
app/             The game (HTML/CSS/JS, loaded via the private geograsp:// scheme)
  js/main.js       title screen, menus, parents dashboard, credits, camera consent
  js/game.js       Easy / Medium / Hard / Capital Cities gameplay
  js/tutorial.js   World Explorer
  js/input.js      hand tracking (MediaPipe) + mouse, unified pointer
  js/audio.js      generative music, sound effects, voice playback
  js/map.js        projection & drawing helpers
  js/i18n.js       English / Japanese text
  voice/           recorded voice clips (en, ja)
  fonts/           Fredoka, M PLUS Rounded 1c (SIL OFL)
scripts/         data, font and voice build scripts
data/            source snapshots & manual overrides
assets/          hand-tracking model, full font sources
build-res/       app icon
```

## Credits & third-party components

- **Created by** Shawn Rapaz with Claude Code — © 2026 Shawn Rapaz, Shouku Games
- Map shapes: [Natural Earth](https://www.naturalearthdata.com/) (public domain) via [world-atlas](https://github.com/topojson/world-atlas) (ISC)
- Country names & regions: [world-countries](https://github.com/mledoze/countries) (ODbL 1.0)
- Capital cities (Japanese names, coordinates): [Wikidata](https://www.wikidata.org/) (CC0)
- Flags: [flag-icons](https://github.com/lipis/flag-icons) (MIT)
- Map projection: [d3-geo](https://github.com/d3/d3-geo), [d3-array](https://github.com/d3/d3-array), [topojson-client](https://github.com/topojson/topojson-client) (ISC)
- Hand tracking: [Google MediaPipe Tasks Vision](https://developers.google.com/mediapipe) & Hand Landmarker model (Apache-2.0)
- Voice: [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0) via kokoro-onnx, misaki (Japanese G2P) and espeak-ng
- Fonts: [Fredoka](https://github.com/hafontia/Fredoka-One) and [M PLUS Rounded 1c](https://github.com/coz-m/MPLUS_FONTS) (SIL Open Font License 1.1, see `app/fonts/`)
- App framework: [Electron](https://www.electronjs.org/) (MIT), packaged with electron-builder

Borders and names follow the sources above and are not a political statement.

## Reporting bugs

See [BUGREPORT.md](BUGREPORT.md) or email <info@shoukugames.org>.

## License

GeoGrasp — Copyright © 2026 Shawn Rapaz

This program is free software: you can redistribute it and/or modify it under the terms of the
GNU General Public License as published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but **WITHOUT ANY WARRANTY**;
without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
[GNU General Public License](LICENSE) for more details.
