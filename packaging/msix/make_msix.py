#!/usr/bin/env python3
"""Make a Microsoft Store package (.msix) of a Windows build.

    python packaging/msix/make_msix.py --app dist/Game-v1.2.3.exe --icon assets/icon.png --out dist-msix
    python packaging/msix/make_msix.py --app dist/win-unpacked --icon build/icon.png --out dist-msix

--app is either the single game .exe (PyInstaller one-file builds) or the folder of an Electron
build (dist/win-unpacked). The package identity comes from packaging/msix/store.json: copy the
values Partner Center shows under Product management -> Product identity into it before
uploading to the Store. The .msix is left unsigned; the Store signs it.

Windows only (uses makeappx.exe from the Windows SDK). Needs Pillow for the tile images.
"""
import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
from xml.sax.saxutils import escape, quoteattr

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))

# Tile images the Store and the Start menu use (file name -> size; wide tiles get the icon centred).
TILES = {
    "StoreLogo.png": (50, 50),
    "Square44x44Logo.png": (44, 44),
    "Square44x44Logo.targetsize-256_altform-unplated.png": (256, 256),
    "Square44x44Logo.targetsize-48_altform-unplated.png": (48, 48),
    "Square44x44Logo.targetsize-24_altform-unplated.png": (24, 24),
    "Square71x71Logo.png": (71, 71),
    "Square150x150Logo.png": (150, 150),
    "Square310x310Logo.png": (310, 310),
    "Wide310x150Logo.png": (310, 150),
}


def version_of(app, store):
    """a.b.c.0 (the Store needs the last number to be 0)."""
    text = store.get("version") or ""
    if not text:
        found = re.search(r"(\d+)\.(\d+)\.(\d+)", os.path.basename(app.rstrip("/\\")))
        text = found.group(0) if found else ""
    parts = re.findall(r"\d+", text)[:3]
    if len(parts) < 3:
        raise SystemExit(f"Could not work out the version of {app}; pass --version 1.2.3")
    return ".".join(str(int(p)) for p in parts) + ".0"


def make_tiles(icon, out_dir, background):
    os.makedirs(out_dir, exist_ok=True)
    src = Image.open(icon).convert("RGBA")
    for name, (w, h) in TILES.items():
        canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0) if background == "transparent" else background)
        side = min(w, h)
        if name.startswith(("Square150", "Square310", "Wide", "Square71")):
            side = int(side * 0.8)   # breathing room on the big tiles
        img = src.resize((side, side), Image.LANCZOS)
        canvas.alpha_composite(img, ((w - side) // 2, (h - side) // 2))
        canvas.save(os.path.join(out_dir, name))


def manifest(store, version, exe):
    caps = "".join(f'\n    <DeviceCapability Name={quoteattr(c)} />' for c in store.get("device_capabilities", []))
    alias = store.get("alias")
    alias_xml = ""
    if alias:
        alias_xml = f"""
      <Extensions>
        <uap5:Extension Category="windows.appExecutionAlias">
          <uap5:AppExecutionAlias>
            <uap5:ExecutionAlias Alias={quoteattr(alias)} />
          </uap5:AppExecutionAlias>
        </uap5:Extension>
      </Extensions>"""
    return f"""<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:uap5="http://schemas.microsoft.com/appx/manifest/uap/windows10/5"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap uap5 rescap">
  <Identity Name={quoteattr(store["identity_name"])} Publisher={quoteattr(store["publisher"])} Version="{version}" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>{escape(store["display_name"])}</DisplayName>
    <PublisherDisplayName>{escape(store["publisher_display_name"])}</PublisherDisplayName>
    <Logo>Assets\\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources>
    <Resource Language="en-us" />
    <Resource Language="ja-jp" />
  </Resources>
  <Applications>
    <Application Id="App" Executable={quoteattr(exe)} EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements DisplayName={quoteattr(store["display_name"])} Description={quoteattr(store["description"])}
        BackgroundColor="transparent" Square150x150Logo="Assets\\Square150x150Logo.png" Square44x44Logo="Assets\\Square44x44Logo.png">
        <uap:DefaultTile Wide310x150Logo="Assets\\Wide310x150Logo.png" Square71x71Logo="Assets\\Square71x71Logo.png" Square310x310Logo="Assets\\Square310x310Logo.png" />
      </uap:VisualElements>{alias_xml}
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />{caps}
  </Capabilities>
</Package>
"""


def find_makeappx():
    found = sorted(glob.glob(r"C:\Program Files (x86)\Windows Kits\10\bin\10.*\x64\makeappx.exe"))
    if not found:
        raise SystemExit("makeappx.exe not found (install the Windows 10/11 SDK)")
    return found[-1]


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--app", required=True, help="the game .exe, or an Electron win-unpacked folder")
    ap.add_argument("--icon", required=True, help="square PNG (256 px or bigger)")
    ap.add_argument("--out", default="dist-msix", help="folder for the .msix")
    ap.add_argument("--store", default=os.path.join(HERE, "store.json"))
    ap.add_argument("--version", help="1.2.3 (default: from the build)")
    args = ap.parse_args()

    with open(args.store, encoding="utf-8") as handle:
        store = json.load(handle)
    if args.version:
        store["version"] = args.version
    version = version_of(args.app, store)
    stage = os.path.join(args.out, "stage")
    shutil.rmtree(stage, ignore_errors=True)
    if os.path.isdir(args.app):
        shutil.copytree(args.app, stage)
        exes = [f for f in os.listdir(stage) if f.lower().endswith(".exe") and not re.match(r"(?i)(un|elevate)", f)]
        exe = max(exes, key=lambda f: os.path.getsize(os.path.join(stage, f)))
    else:
        os.makedirs(stage)
        exe = store["exe_name"]           # a fixed name, so the Start menu and firewall see the same app every version
        shutil.copy2(args.app, os.path.join(stage, exe))
    make_tiles(args.icon, os.path.join(stage, "Assets"), store.get("tile_background", "transparent"))
    with open(os.path.join(stage, "AppxManifest.xml"), "w", encoding="utf-8") as handle:
        handle.write(manifest(store, version, exe))

    out = os.path.join(args.out, f"{store['file_name']}-{version.rsplit('.', 1)[0]}.msix").replace("\\", "/")
    subprocess.run([find_makeappx(), "pack", "/o", "/h", "SHA256", "/d", stage, "/p", out], check=True,
                   stdout=subprocess.DEVNULL)
    shutil.rmtree(stage)
    print(f"{out}  (version {version}, identity {store['identity_name']}, exe {exe})")
    gh = os.environ.get("GITHUB_ENV")
    if gh:
        with open(gh, "a", encoding="utf-8") as handle:
            handle.write(f"MSIX={out}\nMSIX_EXE={exe}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
