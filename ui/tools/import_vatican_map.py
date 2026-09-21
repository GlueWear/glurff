"""Extract the full-resolution artwork embedded in the Vatican map PDFs.

The supplied PDFs are simple Quartz wrappers around one 692x1024 raster image.
Keeping the embedded pixels avoids the 519x768 downsample produced by rendering
the PDF page itself.  This is an import step only; the checked-in PNG/JPEG files
are what the frontend build consumes afterwards.

Run from build/ui:

    python3 tools/import_vatican_map.py '/path/to/vatican map pack'
"""
from pathlib import Path
import argparse
import re
import zlib

from pnglib import write_png


ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'map/vatican-source'


def object_bytes(pdf, number):
    match = re.search(rb'(?m)^' + str(number).encode() + rb' 0 obj\r?\n', pdf)
    if not match:
        raise ValueError(f'PDF object {number} is missing')
    end = pdf.find(b'endobj', match.end())
    if end < 0:
        raise ValueError(f'PDF object {number} is not terminated')
    return pdf[match.end():end]


def stream_bytes(obj):
    length = re.search(rb'/Length\s+(\d+)', obj)
    start = re.search(rb'stream\r?\n', obj)
    if not length or not start:
        raise ValueError('Image stream metadata is missing')
    size = int(length.group(1))
    return obj[start.end():start.end() + size]


def image_meta(obj):
    width = re.search(rb'/Width\s+(\d+)', obj)
    height = re.search(rb'/Height\s+(\d+)', obj)
    kind = re.search(rb'/Filter\s*/(\w+)', obj)
    if not width or not height or not kind:
        raise ValueError('Image dimensions or filter are missing')
    return int(width.group(1)), int(height.group(1)), kind.group(1).decode()


def extract(path, destination):
    pdf = path.read_bytes()
    image = object_bytes(pdf, 5)
    width, height, kind = image_meta(image)
    encoded = stream_bytes(image)
    if kind == 'DCTDecode':
        destination.write_bytes(encoded)
        return width, height
    if kind != 'FlateDecode':
        raise ValueError(f'{path.name}: unsupported image filter {kind}')
    rgb = zlib.decompress(encoded)
    if len(rgb) != width * height * 3:
        raise ValueError(f'{path.name}: unexpected RGB byte count')
    smask = re.search(rb'/SMask\s+(\d+)\s+0\s+R', image)
    if not smask:
        raise ValueError(f'{path.name}: transparent layer has no alpha mask')
    alpha_obj = object_bytes(pdf, int(smask.group(1)))
    aw, ah, alpha_kind = image_meta(alpha_obj)
    if (aw, ah, alpha_kind) != (width, height, 'FlateDecode'):
        raise ValueError(f'{path.name}: unexpected alpha image')
    alpha = zlib.decompress(stream_bytes(alpha_obj))
    if len(alpha) != width * height:
        raise ValueError(f'{path.name}: unexpected alpha byte count')
    rgba = bytearray(width * height * 4)
    for i, a in enumerate(alpha):
        rgba[i * 4:i * 4 + 3] = rgb[i * 3:i * 3 + 3]
        rgba[i * 4 + 3] = a
    write_png(str(destination), width, height, bytes(rgba))
    return width, height


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('pack', type=Path)
    args = parser.parse_args()
    files = {
        'paint layer.pdf': 'picture.jpg',
        'boundary layer.pdf': 'boundary-layer.png',
        'designation layer.pdf': 'designation-layer.png',
        'obscure layer.pdf': 'obscure-layer.png',
    }
    DEST.mkdir(parents=True, exist_ok=True)
    dimensions = set()
    for source, target in files.items():
        path = args.pack / source
        if not path.is_file():
            raise FileNotFoundError(path)
        size = extract(path, DEST / target)
        dimensions.add(size)
        print(f'{source}: {size[0]}x{size[1]} -> {target}')
    if len(dimensions) != 1:
        raise ValueError(f'Layer dimensions disagree: {sorted(dimensions)}')


if __name__ == '__main__':
    main()
