import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Event, BoundedSemaphore, get_ident
from uuid import uuid4
import pytest
from test_client_scope import client, database, login  # noqa: F401
from app import capture_ocr
from app import main
from app.db import DB, User, Session, Permission, Event as WorkspaceEvent, now
from sqlalchemy import select


def test_ocr_rejects_overlap_and_releases_capacity_after_failure(monkeypatch):
    entered, release = Event(), Event()
    monkeypatch.setattr(capture_ocr, '_ocr_capacity', BoundedSemaphore(1))

    def blocked(self, data):
        entered.set()
        assert release.wait(5)
        raise ValueError('Unreadable test image')

    monkeypatch.setattr(capture_ocr.TesseractExtractor, '_extract', blocked)
    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(capture_ocr.extractor.extract, b'isolated-image')
        assert entered.wait(5)
        try:
            with pytest.raises(capture_ocr.OcrBusy):
                capture_ocr.extractor.extract(b'second-image')
        finally:
            release.set()
        with pytest.raises(ValueError):
            first.result(5)
    monkeypatch.setattr(capture_ocr.TesseractExtractor, '_extract', lambda self, data: {'read': True})
    assert capture_ocr.extractor.extract(b'retry')['read']


def test_busy_document_reader_returns_retryable_status(client, monkeypatch):  # noqa: F811
    login(client, 'agent1')

    def busy(data):
        raise capture_ocr.OcrBusy()

    monkeypatch.setattr(capture_ocr.extractor, 'extract', busy)
    response = client.post('/api/kyc-captures/read-document', json={'image_base64': 'aW1hZ2U='})
    assert response.status_code == 503
    assert response.headers['retry-after'] == '2'
    assert 'busy' in response.json()['detail']


def event_request(access_token):
    class Request:
        headers = {'authorization': 'Bearer ' + access_token}

        async def is_disconnected(self):
            return False

    return Request()


async def opened_stream(auth):
    with DB() as db:
        user = db.scalar(select(User).where(User.email == 'agent1@relay.demo'))
        response = await main.event_stream(event_request(auth['access_token']), user, db)
    iterator = response.body_iterator
    assert 'event: connected' in await anext(iterator)
    return iterator


def test_live_poll_wait_does_not_block_other_async_requests(client, monkeypatch):  # noqa: F811
    auth = login(client, 'agent1')
    entered, release = Event(), Event()

    async def verify():
        loop_thread = get_ident()

        def waiting_poll(*args):
            assert get_ident() != loop_thread
            entered.set()
            assert release.wait(3)
            return []

        monkeypatch.setattr(main, 'event_messages', waiting_poll)
        iterator = await opened_stream(auth)
        poll = asyncio.create_task(anext(iterator))
        try:
            assert await asyncio.to_thread(entered.wait, 2)
            # A database checkout wait must not prevent unrelated async work.
            await asyncio.wait_for(asyncio.sleep(0.01), 0.2)
        finally:
            release.set()
            assert await asyncio.wait_for(poll, 2) == ': heartbeat\n\n'
            await iterator.aclose()

    asyncio.run(verify())


def test_live_poll_capacity_retry_retains_cursor_and_delivers_missed_event(client, monkeypatch):  # noqa: F811
    auth = login(client, 'agent1')
    original_poll, cursors, event_ids = main.event_messages, [], []

    def saturated_poll(session_id, user_id, expiry, cursor):
        cursors.append(cursor)
        if len(cursors) == 1:
            with DB() as db:
                event = WorkspaceEvent(agent_id=auth['user']['agent_id'], kind='Capacity retry',
                                       entity_id=str(uuid4()))
                db.add(event)
                db.commit()
                event_ids.append(event.id)
            raise main.DatabasePoolTimeout('Isolated pool capacity test')
        return original_poll(session_id, user_id, expiry, cursor)

    monkeypatch.setattr(main, 'event_messages', saturated_poll)

    async def verify():
        iterator = await opened_stream(auth)
        try:
            assert await anext(iterator) == ': heartbeat\n\n'
            message = await asyncio.wait_for(anext(iterator), 3)
            assert 'Capacity retry' in message and event_ids[0] in message
            assert len(cursors) == 2 and cursors[0] == cursors[1]
        finally:
            await iterator.aclose()

    try:
        asyncio.run(verify())
    finally:
        with DB() as db:
            for identifier in event_ids:
                db.delete(db.get(WorkspaceEvent, identifier))
            db.commit()


@pytest.mark.parametrize('change', ['session_revoked', 'session_expired', 'read_removed'])
def test_live_poll_stops_after_current_authorization_is_removed(client, change):  # noqa: F811
    auth = login(client, 'agent1')
    token = main.jwt.decode(auth['access_token'], main.SECRET, algorithms=['HS256'], audience='relay')
    removed_permission = None

    async def verify():
        nonlocal removed_permission
        iterator = await opened_stream(auth)
        with DB() as db:
            session = db.get(Session, token['sid'])
            if change == 'session_revoked':
                session.revoked = True
            elif change == 'session_expired':
                session.expires = now() - timedelta(seconds=1)
            else:
                user = db.get(User, token['sub'])
                grant = db.scalar(select(Permission).where(Permission.role_id == user.role_id,
                                                           Permission.name == 'read'))
                removed_permission = {'id': grant.id, 'role_id': grant.role_id, 'name': grant.name}
                db.delete(grant)
            db.commit()
        try:
            with pytest.raises(StopAsyncIteration):
                await anext(iterator)
        finally:
            await iterator.aclose()

    try:
        asyncio.run(verify())
    finally:
        if removed_permission:
            with DB() as db:
                db.add(Permission(**removed_permission))
                db.commit()
