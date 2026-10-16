"""Self-contained model explorer assets and safe, lossless result embedding."""

import json
from pathlib import Path
import re

import pytest

from postprocessing.explorer import DATA_MARKER, load_template, render_explorer, write_explorer


@pytest.fixture
def assets(tmp_path):
    directory = tmp_path / "assets"
    directory.mkdir()
    (directory / "index.html").write_text(
        '<html><head><link rel="stylesheet" href="style.css">'
        '<script src="app.js" defer></script></head><body>' + DATA_MARKER + '</body></html>')
    (directory / "style.css").write_text("body { color: navy; }")
    (directory / "app.js").write_text("window.explorerReady = true;")
    return directory


def test_inline_assets_and_all_results_survive_html_script_escaping(assets):
    malicious = '</ScRiPt><script>alert("x")</script><!-- & > \u2028\u2029'
    comparison = {"experiments": [{"run_id": "baseline", "explanation": malicious}, {"run_id": "variant"}],
                  "predictions": [{"signal_score": .25}, {"signal_score": .75}]}
    html = render_explorer(comparison, load_template(assets))
    match = re.search(r'<script type="application/json" id="model-explorer-data">(.*?)</script>', html, re.DOTALL)
    assert match and json.loads(match.group(1)) == comparison
    assert "<" not in match.group(1) and "&" not in match.group(1)
    assert "\u2028" not in match.group(1) and "\u2029" not in match.group(1)
    assert 'src="app.js"' not in html and 'href="style.css"' not in html
    assert "body { color: navy; }" in html and "window.explorerReady = true;" in html
    assert html.index('id="model-explorer-data"') < html.index("window.explorerReady") < html.index("</body>")


def test_missing_assets_report_how_to_restore_them(tmp_path):
    with pytest.raises(ValueError, match="Cannot read model explorer assets.*Restore tools/model-explorer/"):
        load_template(tmp_path / "missing")


@pytest.mark.parametrize("marker", [DATA_MARKER, '<link rel="stylesheet" href="style.css">',
                                    '<script src="app.js" defer></script>', "</body>"])
def test_missing_or_duplicate_template_markers_fail_clearly(assets, marker):
    template = assets / "index.html"
    original = template.read_text()
    for replacement in ("", marker + marker):
        template.write_text(original.replace(marker, replacement))
        with pytest.raises(ValueError, match="exactly one"):
            load_template(assets)


@pytest.mark.parametrize("filename,payload", [("app.js", "// </script>"), ("style.css", "/* </STYLE> */")])
def test_unexpected_asset_closing_tags_fail_clearly(assets, filename, payload):
    (assets / filename).write_text(payload)
    with pytest.raises(ValueError, match="closing HTML"):
        load_template(assets)


def test_write_creates_nested_output_and_preserves_old_page_on_failure(tmp_path, monkeypatch):
    path = tmp_path / "outputs with spaces" / "nested" / "model-explorer.html"
    write_explorer(path, "<html>existing</html>")
    assert path.read_text() == "<html>existing</html>"
    def fail_replace(*args):
        raise PermissionError("read-only destination")
    monkeypatch.setattr(Path, "replace", fail_replace)
    with pytest.raises(OSError, match="Cannot write model explorer.*read-only destination"):
        write_explorer(path, "<html>replacement</html>")
    assert path.read_text() == "<html>existing</html>"
    assert list(path.parent.iterdir()) == [path]


def test_nonfinite_data_cannot_be_published(assets):
    with pytest.raises(ValueError, match="JSON compliant"):
        render_explorer({"score": float("nan")}, load_template(assets))
