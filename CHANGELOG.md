# Changelog

All notable changes to GeoGrasp are documented here. This project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-11-09

First release.

### Added
- Hand-tracking controls via the device camera (Google MediaPipe Hand Landmarker, running 100% offline):
  pinch to grab a piece, open your hand to drop it, hold still to point. Pinching over buttons presses them.
- Mouse / touch control as a full substitute when the camera is not allowed or not available.
- Parent gate + camera consent dialog (camera is offline, never recorded, shuts off when the game closes).
- **Easy** mode: pick any country piece from the tray and place it on the world map.
- **Medium** mode: a voice names a country; find the right piece among several and place it.
- **Hard** mode: place the seven continents on an empty world map.
- **Capital Cities** mode: hear a capital city, point to its country (10 questions).
- 120-second countdown per piece / question, with hints after repeated mistakes.
- Map regions: World, Africa, Asia, Europe, North America, South America, Oceania.
- **Tutorial / World Explorer**: map with every country, its capital (marked with a star) and national flag.
- **For Parents** dashboard: time played, games played, scores, accuracy, per-game right/wrong details,
  "needs practice" and "got right" lists, camera permission, reset.
- Natural recorded voice (Kokoro neural voice) for every country, capital and continent in English and Japanese.
- Relaxing generative ambient soundtrack and synthesised sound effects.
- Full English / Japanese (日本語) user interface.
- Credits panel, GPL-3.0 license.
- Linux `.deb` package and Windows installer / portable `.exe`.
