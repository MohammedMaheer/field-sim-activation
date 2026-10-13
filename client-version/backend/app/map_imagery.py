"""Optional public imagery metadata; work-location enforcement never depends on maps."""

import re
import threading
import time
import urllib.request
from datetime import date
from xml.etree import ElementTree

from fastapi import APIRouter, Depends, HTTPException

from .security import principal, permissions
from .db import get_db

router = APIRouter(prefix="/api/location-tracking", tags=["Work location"])
LAYER = "MODIS_Terra_CorrectedReflectance_TrueColor"
CAPABILITIES = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml"
SOURCE = "https://nasa-gibs.github.io/gibs-api-docs/access-basics/"
CLOUDLESS_CAPABILITIES = "https://tiles.maps.eox.at/wmts?service=WMTS&request=GetCapabilities"
CLOUDLESS_SOURCE = "https://s2maps.eu/"
NS = {"w": "http://www.opengis.net/wmts/1.0", "o": "http://www.opengis.net/ows/1.1"}
_lock = threading.Lock()
_cached = None
_expires = 0.0


def parse_metadata(document: bytes) -> dict:
    """Use the provider's reported date, never assume today's imagery exists."""
    root = ElementTree.fromstring(document)
    layer = next((row for row in root.findall(".//w:Layer", NS)
                  if row.findtext("o:Identifier", namespaces=NS) == LAYER), None)
    if layer is None:
        raise ValueError("Imagery layer unavailable")
    dimensions = layer.findall("w:Dimension", NS)
    dimension = next((row for row in dimensions
                      if (row.findtext("o:Identifier", namespaces=NS) or "").lower() == "time"), None)
    observed = dimension.findtext("w:Default", namespaces=NS) if dimension is not None else None
    if not observed or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", observed):
        raise ValueError("Imagery date unavailable")
    date.fromisoformat(observed)
    matrix = layer.findtext("w:TileMatrixSetLink/w:TileMatrixSet", namespaces=NS)
    if matrix != "GoogleMapsCompatible_Level9":
        raise ValueError("Unsupported imagery resolution")
    return {
        "available": True, "available_date": observed, "layer": LAYER,
        "tile_url": f"https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{LAYER}/default/{observed}/{matrix}/{{z}}/{{y}}/{{x}}.jpeg",
        "max_zoom": 9, "resolution_m": 250, "source_url": SOURCE,
        "attribution": "NASA EOSDIS GIBS / Terra MODIS",
        "note": "Dated satellite overview; clouds or missing coverage may obscure locations. Use street maps to set precise boundaries.",
    }


def parse_cloudless_metadata(document: bytes) -> dict:
    """Only use the commercially permitted 2016 CC-BY mosaic, with its real age."""
    root = ElementTree.fromstring(document)
    layer = next((row for row in root.findall(".//w:Layer", NS)
                  if row.findtext("o:Identifier", namespaces=NS) == "s2cloudless_3857"), None)
    if layer is None:
        raise ValueError("Cloudless mosaic unavailable")
    title = layer.findtext("o:Title", namespaces=NS) or ""
    license_text = layer.findtext("o:Abstract", namespaces=NS) or ""
    if "2016" not in title or "creativecommons.org/licenses/by/4.0/" not in license_text:
        raise ValueError("The permitted imagery year or license changed")
    if "GoogleMapsCompatible" not in [row.text for row in layer.findall("w:TileMatrixSetLink/w:TileMatrixSet", NS)]:
        raise ValueError("Unsupported map projection")
    return {"available": True, "available_date": "2016", "layer": "s2cloudless_3857",
        "tile_url": "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg",
        "max_zoom": 14, "resolution_m": 10, "source_url": CLOUDLESS_SOURCE,
        "attribution": "Sentinel-2 cloudless by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)",
        "license_url": "https://creativecommons.org/licenses/by/4.0/",
        "label": "Cloudless satellite mosaic", "provider": "EOX / Copernicus",
        "note": "Cloudless composite from 2016; this is not live or current imagery. Use street maps for current worksite boundaries, or open Google satellite / Street View for finer detail where available."}


def imagery_metadata() -> dict:
    global _cached, _expires
    with _lock:
        if _cached is not None and time.monotonic() < _expires:
            return dict(_cached)
        try:
            request = urllib.request.Request(CLOUDLESS_CAPABILITIES, headers={"User-Agent": "QanawatMaps/1.0"})
            with urllib.request.urlopen(request, timeout=6) as response:
                content = response.read(8 * 1024 * 1024 + 1)
            if len(content) > 8 * 1024 * 1024:
                raise ValueError("Imagery metadata exceeds limit")
            _cached = parse_cloudless_metadata(content)
            _expires = time.monotonic() + 6 * 60 * 60
        except Exception:
            # Optional provider failure must not break shifts, capture, or the map editor.
            _cached = {"available": False, "reason": "Cloudless satellite imagery is temporarily unavailable. Street maps remain available.", "source_url": CLOUDLESS_SOURCE}
            _expires = time.monotonic() + 60
        return dict(_cached)


@router.get("/map-imagery")
def map_imagery(user=Depends(principal), db=Depends(get_db)):
    if not permissions(db, user) & {"location.self", "location.read", "location.manage"}:
        raise HTTPException(403, "Work location access is unavailable")
    return imagery_metadata()
