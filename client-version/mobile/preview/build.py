"""Build the shared-backend, signed-in Flutter browser demo."""
from pathlib import Path
import os, shutil, subprocess
root = Path(__file__).resolve().parents[1]
bootstrap = root / "web/flutter_bootstrap.js"
previous = bootstrap.read_bytes() if bootstrap.exists() else None
try:
    shutil.copyfile(root / "preview/flutter_bootstrap.js", bootstrap)
    subprocess.run([os.environ.get("FLUTTER_BIN", "flutter.bat" if os.name == "nt" else "flutter"), "build", "web", "--release", "--target=lib/preview_main.dart", "--base-href=/mobile-demo/", "--no-web-resources-cdn", "--pwa-strategy=none"], cwd=root, check=True)
    for name in ["index.html", "preview.css", "preview.js"]:
        shutil.copyfile(root / "preview" / name, root / "build/web" / name)
finally:
    if previous is None:
        bootstrap.unlink(missing_ok=True)
    else:
        bootstrap.write_bytes(previous)
