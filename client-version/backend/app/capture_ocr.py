"""Local Tesseract extraction. No screenshot is sent to an external service."""

import csv
import io
import os
import re
import subprocess
import tempfile
from collections import defaultdict
from pathlib import Path
from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 6_000_000


def inspect_image(data):
    if not data or len(data) > 4_000_000:
        raise ValueError("Upload a PNG or JPEG image up to 4 MB")
    try:
        with Image.open(io.BytesIO(data)) as img:
            if img.format not in {"PNG", "JPEG"} or getattr(img, "n_frames", 1) != 1:
                raise ValueError("Only single-frame PNG and JPEG images are supported")
            if img.width * img.height > 6_000_000 or min(img.size) < 80:
                raise ValueError(
                    "Use an image of at least 80 pixels per side and at most 6 megapixels"
                )
            kind = img.format
            img.verify()
        return "image/png" if kind == "PNG" else "image/jpeg"
    except (OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ValueError("The image cannot be decoded safely") from exc


def organize_lines(lines):
    """Conservative label mapping; unknown layouts remain OCR lines for manual review."""
    rows = []
    current = None
    for index, line in enumerate(lines):
        text = line["text"].strip()
        reference = re.match(
            r"^(?:Transaction\s+(?:Reference|ID|Number)|Request\s+ID|Order\s+(?:ID|Number)|SR\s+ID)\s*[:#]\s*(.+)$",
            text,
            re.I,
        )
        if reference:
            current = {
                "reference": reference[1][:120],
                "customer": "",
                "account": "",
                "details": text[:1000],
                "source_line": index,
            }
            rows.append(current)
        elif current:
            label = re.match(
                r"^(Customer(?:\s+Name)?|Account|MSISDN|Mobile(?:\s+Number)?)\s*:\s*(.+)$",
                text,
                re.I,
            )
            if label:
                key = "customer" if label[1].lower().startswith("customer") else "account"
                current[key] = label[2][: 120 if key == "customer" else 80]
            else:
                current["details"] = (current["details"] + "\n" + text)[:1000]
    return rows[:100]


class TesseractExtractor:
    def extract(self, data):
        inspect_image(data)
        with tempfile.TemporaryDirectory(prefix="relay-ocr-") as folder:
            source = Path(folder) / "source.png"
            with Image.open(io.BytesIO(data)) as image:
                ImageOps.autocontrast(ImageOps.exif_transpose(image).convert("L")).save(source)
            result = subprocess.run(
                [
                    os.getenv("TESSERACT_BIN", "tesseract"),
                    str(source),
                    "stdout",
                    "-l",
                    "eng+ara",
                    "--psm",
                    "6",
                    "tsv",
                ],
                capture_output=True,
                timeout=45,
                check=True,
                env={**os.environ, "OMP_THREAD_LIMIT": "1"},
            )
        groups = defaultdict(list)
        for word in csv.DictReader(
            io.StringIO(result.stdout.decode("utf-8", errors="replace")), delimiter="\t"
        ):
            if word.get("level") == "5" and word.get("text", "").strip():
                groups[(word["block_num"], word["par_num"], word["line_num"])].append(word)
        lines = []
        for words in list(groups.values())[:200]:
            lines.append(
                {
                    "text": " ".join(w["text"] for w in words)[:1000],
                    "confidence": round(
                        sum(max(0, float(w["conf"])) for w in words) / len(words), 1
                    ),
                }
            )
        if not lines:
            raise ValueError("No readable text found. Upload a clearer screenshot and retry.")
        return {
            "engine": "Tesseract VPS",
            "lines": lines,
            "rows": organize_lines(lines),
            "history": [],
        }


extractor = TesseractExtractor()
