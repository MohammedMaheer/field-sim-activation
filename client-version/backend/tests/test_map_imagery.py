import pytest
import test_client_scope as shared
from app import map_imagery as imagery
from sqlalchemy import select
from app.db import DB, Permission, Role

client, database, login = shared.client, shared.database, shared.login


def capabilities(date="2026-10-12", matrix="GoogleMapsCompatible_Level9"):
    return f'''<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:o="http://www.opengis.net/ows/1.1"><Contents><Layer><o:Identifier>{imagery.LAYER}</o:Identifier><Dimension><o:Identifier>Time</o:Identifier><Default>{date}</Default></Dimension><TileMatrixSetLink><TileMatrixSet>{matrix}</TileMatrixSet></TileMatrixSetLink></Layer></Contents></Capabilities>'''.encode()


def test_provider_date_resolution_and_fixed_tile_source():
    result = imagery.parse_metadata(capabilities())
    assert result["available_date"] == "2026-10-12"
    assert result["resolution_m"] == 250 and result["max_zoom"] == 9
    assert "/2026-10-12/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpeg" in result["tile_url"]
    assert "Use street maps" in result["note"]


@pytest.mark.parametrize("stamp,matrix", [("", "GoogleMapsCompatible_Level9"), ("2026-99-30", "GoogleMapsCompatible_Level9"), ("2026-10-12", "Unknown")])
def test_missing_date_or_unknown_resolution_is_not_fabricated(stamp, matrix):
    with pytest.raises(ValueError):
        imagery.parse_metadata(capabilities(stamp, matrix))


def test_provider_failure_is_cached_and_does_not_break_work(monkeypatch):
    monkeypatch.setattr(imagery, "_cached", None)
    monkeypatch.setattr(imagery, "_expires", 0)
    calls = []
    def unavailable(*args, **kwargs):
        calls.append(1)
        raise TimeoutError()
    monkeypatch.setattr(imagery.urllib.request, "urlopen", unavailable)
    assert imagery.imagery_metadata()["available"] is False
    assert imagery.imagery_metadata()["available"] is False
    assert len(calls) == 1


def test_optional_map_metadata_requires_effective_member_grant(client, monkeypatch):
    monkeypatch.setattr(imagery, "imagery_metadata", lambda: imagery.parse_metadata(capabilities()))
    assert client.get('/api/location-tracking/map-imagery').status_code == 401
    for account in ('admin', 'ops', 'agent1', 'leader', 'salesmanager', 'tele', 'welcome'):
        login(client, account)
        response = client.get('/api/location-tracking/map-imagery')
        assert response.status_code == 200, response.text
        assert response.json()['available_date'] == '2026-10-12'
    login(client, 'agent1')
    with DB() as db:
        grant = db.scalar(select(Permission).join(Role).where(Role.name == 'Field Agent', Permission.name == 'location.self'))
        saved = {key: getattr(grant, key) for key in ('id', 'created_at', 'role_id', 'name')}
        db.delete(grant)
        db.commit()
    try:
        assert client.get('/api/location-tracking/map-imagery').status_code == 403
    finally:
        with DB() as db:
            db.add(Permission(**saved))
            db.commit()


def cloudless_capabilities(title="Cloudless 2016", licence="https://creativecommons.org/licenses/by/4.0/"):
    return f'''<Capabilities xmlns="http://www.opengis.net/wmts/1.0" xmlns:o="http://www.opengis.net/ows/1.1"><Contents><Layer><o:Identifier>s2cloudless_3857</o:Identifier><o:Title>{title}</o:Title><o:Abstract>{licence}</o:Abstract><TileMatrixSetLink><TileMatrixSet>GoogleMapsCompatible</TileMatrixSet></TileMatrixSetLink></Layer></Contents></Capabilities>'''.encode()


def test_cloudless_map_is_precisely_dated_and_commercially_permitted():
    data = imagery.parse_cloudless_metadata(cloudless_capabilities())
    assert data['available_date'] == '2016'
    assert data['resolution_m'] == 10 and data['max_zoom'] == 14
    assert data['license_url'].endswith('/by/4.0/')
    assert 's2cloudless_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg' in data['tile_url']
    assert 'not live or current' in data['note']


@pytest.mark.parametrize('title,licence', [('2024 mosaic', 'https://creativecommons.org/licenses/by/4.0/'), ('2016 mosaic','https://creativecommons.org/licenses/by-nc-sa/4.0/')])
def test_cloudless_mosaic_rejects_changed_age_or_noncommercial_license(title,licence):
    with pytest.raises(ValueError): imagery.parse_cloudless_metadata(cloudless_capabilities(title,licence))
