"""Render the shared model explorer as one HTML file with its results included."""

import json
import os
from pathlib import Path
import re
import tempfile

from common import ROOT

ASSETS_DIR = ROOT / "tools/model-explorer"
DATA_MARKER = '<script type="application/json" id="model-explorer-data"></script>'
STYLE_MARKER = '<link rel="stylesheet" href="style.css">'
SCRIPT_MARKER = '<script src="app.js" defer></script>'


def load_template(assets_dir: Path = ASSETS_DIR) -> str:
    """Check local assets before postprocessing replaces any saved comparison."""
    try:
        template, css, javascript = (
            (assets_dir / name).read_text(encoding="utf-8")
            for name in ("index.html", "style.css", "app.js")
        )
    except (OSError, UnicodeError) as error:
        raise ValueError(f"Cannot read model explorer assets in {assets_dir}. "
                         "Restore tools/model-explorer/ or rebuild the workshop Docker image.") from error
    for marker in (DATA_MARKER, STYLE_MARKER, SCRIPT_MARKER, "</body>"):
        if template.count(marker) != 1:
            raise ValueError(f"Model explorer template requires exactly one {marker!r} marker.")
    if re.search(r"</style", css, re.IGNORECASE) or re.search(r"</script", javascript, re.IGNORECASE):
        raise ValueError("Model explorer CSS/JavaScript cannot contain closing HTML style/script tags.")
    # Inline classic scripts ignore defer; run after the controls and JSON exist.
    return (template.replace(STYLE_MARKER, f"<style>\n{css}\n</style>")
            .replace(SCRIPT_MARKER, "")
            .replace("</body>", f"<script>\n{javascript}\n</script>\n</body>"))


def render_explorer(comparison: dict, template: str) -> str:
    """Embed every comparison row without allowing data to close its script tag."""
    if template.count(DATA_MARKER) != 1:
        raise ValueError("Model explorer template is missing its unique data marker.")
    payload = json.dumps(comparison, ensure_ascii=True, allow_nan=False, separators=(",", ":"))
    payload = payload.replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e")
    return template.replace(DATA_MARKER, DATA_MARKER.replace("></script>", f">{payload}</script>"))


def write_explorer(path: Path, content: str) -> None:
    """Publish a complete UTF-8 page atomically, including for custom output paths."""
    temporary = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n",
                                         dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.chmod(0o644)
        temporary.replace(path)
    except OSError as error:
        raise OSError(f"Cannot write model explorer to {path}: {error}") from error
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)
