"""Explicit public-place searches, cached and limited across API workers.

No autocomplete, reverse tracking, bulk lookup or member coordinates are sent.
The compatible provider URL can be replaced through deployment configuration.
"""
import json
import math
import os
import threading
import time
import urllib.parse
import urllib.request
from collections import OrderedDict
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from .db import get_db
from .security import permissions, principal

router = APIRouter(prefix='/api/location-tracking', tags=['Work location'])
_cache = OrderedDict()
_lock = threading.Lock()
_next_request = 0.0
POLICY = 'https://operations.osmfoundation.org/policies/nominatim/'


def search_places(query, db):
    global _next_request
    provider = os.getenv('MAP_SEARCH_URL', 'https://nominatim.openstreetmap.org/search')
    parsed = urllib.parse.urlsplit(provider)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise HTTPException(503, 'Place search is not configured correctly. Use the map pin or coordinates.')
    key = (provider, ' '.join(query.split()).casefold())
    cached = _cache.get(key)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    if not _lock.acquire(blocking=False):
        raise HTTPException(429, 'Place search is busy. Please wait a moment and search again.', headers={'Retry-After':'2'})
    postgres = db.bind.dialect.name == 'postgresql'
    started = None
    held = False
    try:
        if time.monotonic() < _next_request:
            raise HTTPException(429, 'Please wait a moment before another place search.', headers={'Retry-After':'2'})
        if postgres:
            held = bool(db.scalar(text('SELECT pg_try_advisory_xact_lock(82821014)')))
            if not held:
                raise HTTPException(429, 'Place search is busy. Please try again shortly.', headers={'Retry-After':'2'})
        started = time.monotonic()
        _next_request = started + 1.1
        params = urllib.parse.urlencode({'q':query, 'format':'jsonv2', 'limit':5, 'addressdetails':0})
        origin = os.getenv('WEB_ORIGIN', 'https://www.qanawat.ae').rstrip('/')
        request = urllib.request.Request(provider+'?'+params,
            headers={'User-Agent':f'Qanawat-Worksite-Search/1.0 (+{origin})','Referer':origin,'Accept':'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=6) as response:
                document = response.read(256*1024+1)
            if len(document)>256*1024: raise ValueError('Response too large')
            rows=json.loads(document)
            if not isinstance(rows,list): raise ValueError('Invalid provider response')
            results=[]
            for row in rows[:5]:
                lat, lon=float(row['lat']),float(row['lon'])
                if not math.isfinite(lat) or not math.isfinite(lon) or abs(lat)>85 or abs(lon)>180:
                    continue
                results.append({'id':str(row.get('place_id') or f'{lat}:{lon}'),
                    'name':str(row.get('display_name') or 'Selected place')[:350], 'latitude':lat,'longitude':lon})
        except Exception:
            raise HTTPException(503,'Place search is temporarily unavailable. Drop a pin or enter coordinates instead.') from None
        result={'results':results,'attribution':'© OpenStreetMap contributors', 'source':'Nominatim-compatible search', 'policy_url':POLICY}
        _cache[key]=(time.monotonic()+3600,result)
        _cache.move_to_end(key)
        while len(_cache)>256: _cache.popitem(last=False)
        return result
    finally:
        # Holding the PostgreSQL lock for at least 1.1 seconds limits the
        # aggregate application rate, even with multiple worker processes.
        if held and started is not None:
            time.sleep(max(0,1.1-(time.monotonic()-started)))
        if postgres:
            db.rollback()
        _lock.release()


@router.get('/place-search')
def place_search(q: str = Query(min_length=2,max_length=160), user=Depends(principal),db=Depends(get_db)):
    if not permissions(db,user) & {'location.self','location.read','location.manage'}:
        raise HTTPException(403,'Work location access is unavailable')
    query=' '.join(q.split())
    if len(query)<2:
        raise HTTPException(422,'Enter a city, street or public place to search.')
    return search_places(query,db)
