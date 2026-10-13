import io
import json
import pytest
import test_client_scope as shared
from app import place_search as search
from app.db import DB

client, database, login = shared.client, shared.database, shared.login


@pytest.fixture(autouse=True)
def search_state(monkeypatch):
    search._cache.clear()
    monkeypatch.setattr(search,'_next_request',0)
    monkeypatch.delenv('MAP_SEARCH_URL',raising=False)
    yield
    search._cache.clear()


def provider(monkeypatch, rows):
    calls=[]
    def read(request,timeout):
        calls.append(request)
        return io.BytesIO(json.dumps(rows).encode())
    monkeypatch.setattr(search.urllib.request,'urlopen',read)
    return calls


def test_explicit_search_uses_identified_provider_and_cached_results(client,monkeypatch):
    calls=provider(monkeypatch,[{'place_id':123,'display_name':'Dubai Marina Mall, UAE','lat':'25.077','lon':'55.140'}])
    assert client.get('/api/location-tracking/place-search?q=Dubai').status_code==401
    login(client,'agent1')
    result=client.get('/api/location-tracking/place-search?q=Dubai%20Marina')
    assert result.status_code==200 and result.json()['results'][0]['latitude']==25.077
    assert len(calls)==1 and calls[0].get_header('User-agent').startswith('Qanawat-Worksite-Search')
    assert 'limit=5' in calls[0].full_url and 'latitude=' not in calls[0].full_url
    assert client.get('/api/location-tracking/place-search?q=Dubai%20Marina').json()==result.json()
    assert len(calls)==1


def test_provider_failure_keeps_manual_coordinates_available(client,monkeypatch):
    def failure(*args,**kwargs): raise TimeoutError('private provider diagnostic')
    monkeypatch.setattr(search.urllib.request,'urlopen',failure)
    login(client)
    result=client.get('/api/location-tracking/place-search?q=Public%20landmark')
    assert result.status_code==503 and 'Drop a pin' in result.json()['detail']
    assert 'private provider' not in result.text


def test_uncached_queries_are_rate_limited_and_invalid_points_are_skipped(client,monkeypatch):
    calls=provider(monkeypatch,[{'display_name':'Invalid','lat':'NaN','lon':0},{'display_name':'Public city','lat':25,'lon':55}])
    login(client)
    first=client.get('/api/location-tracking/place-search?q=City')
    assert len(first.json()['results'])==1
    second=client.get('/api/location-tracking/place-search?q=Different%20city')
    assert second.status_code==429 and second.headers['retry-after']=='2'
    assert len(calls)==1


def test_search_provider_is_switchable_without_a_client_update(client,monkeypatch):
    monkeypatch.setenv('MAP_SEARCH_URL','https://geocoding.example.test/search')
    calls=provider(monkeypatch,[])
    login(client)
    assert client.get('/api/location-tracking/place-search?q=City').json()['results']==[]
    assert calls[0].full_url.startswith('https://geocoding.example.test/search?')


def test_invalid_configuration_and_blank_query_do_not_call_provider(client,monkeypatch):
    calls=provider(monkeypatch,[])
    login(client)
    assert client.get('/api/location-tracking/place-search?q=%20%20').status_code==422
    monkeypatch.setenv('MAP_SEARCH_URL','http://invalid-provider/search')
    assert client.get('/api/location-tracking/place-search?q=City').status_code==503
    assert not calls
