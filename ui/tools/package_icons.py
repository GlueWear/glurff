"""Embed the packaged icon into Landscape and NEW commons-note installations.

The PNGs are prepared separately; this tool copies bytes without editing art.
No existing Noltbook note is reinstalled or modified. The favicon gets a content
version so browsers pick up an icon change on the next page load.
"""
from pathlib import Path
import base64
import hashlib
import re

ui = Path(__file__).resolve().parents[1]
desk = ui.parent / 'desk'
icon = 'data:image/png;base64,' + base64.b64encode((ui / 'public/glurff-icon.png').read_bytes()).decode()
assert len(icon) <= 71680, 'Noltbook gossip icon limit'
(desk / 'lib/glurff-icon.hoon').write_text(":: Temporary Glurff icon, embedded by ui/tools/package_icons.py.\n'" + icon + "'\n")
docket = desk / 'desk.docket-0'
text, count = re.subn(r"(?m)^  image\+'.*'$", lambda _: "  image+'" + icon + "'", docket.read_text())
assert count == 1, 'Expected exactly one Landscape image'
docket.write_text(text)
favicon_hash = hashlib.sha256((ui / 'public/favicon.png').read_bytes()).hexdigest()[:12]
entry = ui / 'index.html'
text, count = re.subn(r'href="/apps/glurff/favicon\.png(?:\?v=[a-z0-9-]+)?"',
                     'href="/apps/glurff/favicon.png?v=' + favicon_hash + '"', entry.read_text())
assert count == 1, 'Expected exactly one favicon'
entry.write_text(text)
print(f'Embedded {len(icon)} byte icon; favicon version {favicon_hash}. Existing notes untouched.')
