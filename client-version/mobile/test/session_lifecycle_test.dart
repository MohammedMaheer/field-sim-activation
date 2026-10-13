import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/preview_main.dart';
import 'package:relay_agent/services.dart';

class SessionMemoryStore extends OfflineStore {
  @override
  Future<void> put(String id, Json value) async => browserMemory[id] = value;
  @override
  Future<Json?> get(String id) async => browserMemory[id];
  @override
  Future<void> clear() async => browserMemory.clear();
}

class NativeSessionService extends RelayService {
  final memory = SessionMemoryStore();
  @override
  OfflineStore get store => memory;
  @override
  Future<void> sync() async {}
}

class DemoSessionService extends SharedPreviewService {
  final memory = SessionMemoryStore();
  DemoSessionService() : super(baseUrl: 'https://example.test/api');
  @override
  OfflineStore get store => memory;
  @override
  Future<void> sync() async {}
}

class NativeSyncSessionService extends RelayService {
  final memory = SessionMemoryStore();
  @override
  OfflineStore get store => memory;
}

class DemoSyncSessionService extends SharedPreviewService {
  final memory = SessionMemoryStore();
  DemoSyncSessionService() : super(baseUrl: 'https://example.test/api');
  @override
  OfflineStore get store => memory;
}

Json account(String id) => {
  'access_token': 'access-$id',
  'refresh_token': 'refresh-$id',
  'user': {
    'id': id,
    'role': 'Field Agent',
    'permissions': ['read'],
  },
};

void complete(
  RequestOptions options,
  RequestInterceptorHandler handler,
  Json data,
) => handler.resolve(
  Response(requestOptions: options, statusCode: 200, data: data),
);

void deny(
  RequestOptions options,
  RequestInterceptorHandler handler,
  int status,
) => handler.reject(
  DioException(
    requestOptions: options,
    response: Response(requestOptions: options, statusCode: status),
  ),
);

class SessionAdapter implements HttpClientAdapter {
  SessionAdapter(this.response);
  final Future<ResponseBody> Function(RequestOptions) response;
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) => response(options);
  @override
  void close({bool force = false}) {}
}

ResponseBody httpResponse(int status, [Json data = const {}]) =>
    ResponseBody.fromString(
      jsonEncode(data),
      status,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(
    () => FlutterSecureStorage.setMockInitialValues({
      'relay_refresh': 'refresh-old',
      'relay_mobile_demo_refresh_v1': 'refresh-old',
    }),
  );

  for (final demo in [false, true]) {
    RelayService create() {
      final service = demo ? DemoSessionService() : NativeSessionService();
      service.user = Json.from(account('old')['user']);
      service.access = 'access-old';
      addTearDown(service.dispose);
      return service;
    }

    final edition = demo ? 'browser demo' : 'native';

    test(
      '$edition delayed refresh cannot restore a signed-out session',
      () async {
        final service = create();
        final pending =
            Completer<(RequestOptions, RequestInterceptorHandler)>();
        service.dio.interceptors.add(
          InterceptorsWrapper(
            onRequest: (options, handler) {
              if (options.path == '/auth/refresh') {
                pending.complete((options, handler));
              } else {
                complete(options, handler, {});
              }
            },
          ),
        );
        final refreshing = service.refresh();
        final expired = expectLater(refreshing, throwsStateError);
        final (options, handler) = await pending.future;
        await service.logout();
        complete(options, handler, account('old'));
        await expired;
        expect(service.user, isNull);
        expect(service.access, isNull);
        expect(
          await service.store.secure.read(key: service.refreshStorageKey),
          isNull,
        );
      },
    );

    test(
      '$edition delayed refresh cannot replace a newer signed-in account',
      () async {
        final service = create();
        final pending =
            Completer<(RequestOptions, RequestInterceptorHandler)>();
        service.dio.interceptors.add(
          InterceptorsWrapper(
            onRequest: (options, handler) {
              if (options.path == '/auth/refresh') {
                pending.complete((options, handler));
              } else {
                complete(options, handler, account('new'));
              }
            },
          ),
        );
        final refreshing = service.refresh();
        final expired = expectLater(refreshing, throwsStateError);
        final (options, handler) = await pending.future;
        await service.login('new@example.test', 'synthetic');
        complete(options, handler, account('old'));
        await expired;
        expect(service.user?['id'], 'new');
        expect(service.access, 'access-new');
        expect(
          await service.store.secure.read(key: service.refreshStorageKey),
          'refresh-new',
        );
      },
    );

    test('$edition temporary refresh outage does not force sign-out', () async {
      final service = create();
      service.dio.httpClientAdapter = SessionAdapter(
        (options) async =>
            httpResponse(options.path == '/auth/refresh' ? 503 : 401),
      );
      await expectLater(
        service.dio.get('/resources/agents'),
        throwsA(isA<DioException>()),
      );
      expect(service.user?['id'], 'old');
      expect(service.access, 'access-old');
      expect(
        await service.store.secure.read(key: service.refreshStorageKey),
        'refresh-old',
      );
    });

    test(
      '$edition rejected refresh ends access without an infinite retry',
      () async {
        final service = create();
        var refreshes = 0;
        service.dio.httpClientAdapter = SessionAdapter((options) async {
          if (options.path == '/auth/refresh') refreshes++;
          return httpResponse(401);
        });
        await expectLater(
          service.dio.get('/resources/agents'),
          throwsA(isA<DioException>()),
        );
        expect(refreshes, 1);
        expect(service.user, isNull);
        expect(service.access, isNull);
      },
    );

    test(
      '$edition concurrent expiry responses share one token rotation',
      () async {
        final service = create();
        var refreshes = 0;
        final started = Completer<void>();
        final refreshed = Completer<ResponseBody>();
        service.dio.httpClientAdapter = SessionAdapter((options) async {
          if (options.path == '/auth/refresh') {
            refreshes++;
            if (!started.isCompleted) started.complete();
            return refreshed.future;
          }
          return options.extra['retried'] == true
              ? httpResponse(200, {'ok': true})
              : httpResponse(401);
        });
        final first = service.dio.get('/resources/agents');
        final second = service.dio.get('/resources/plans');
        await started.future;
        await Future<void>.delayed(Duration.zero);
        expect(refreshes, 1);
        refreshed.complete(httpResponse(200, account('old')));
        final responses = await Future.wait([first, second]);
        expect(responses.every((row) => row.data['ok'] == true), isTrue);
        expect(refreshes, 1);
        expect(service.user?['id'], 'old');
      },
    );

    test(
      '$edition delayed login cannot recreate the signed-out account',
      () async {
        final service = create();
        final pending =
            Completer<(RequestOptions, RequestInterceptorHandler)>();
        service.dio.interceptors.add(
          InterceptorsWrapper(
            onRequest: (options, handler) {
              if (options.path.endsWith('/login')) {
                pending.complete((options, handler));
              } else {
                complete(options, handler, {});
              }
            },
          ),
        );
        final signingIn = service.login('new@example.test', 'synthetic');
        final obsolete = expectLater(signingIn, throwsStateError);
        final (options, handler) = await pending.future;
        await service.logout();
        complete(options, handler, account('new'));
        await obsolete;
        expect(service.user, isNull);
        expect(service.access, isNull);
        expect(
          await service.store.secure.read(key: service.refreshStorageKey),
          isNull,
        );
      },
    );

    test(
      '$edition late unauthorized response cannot refresh a different account',
      () async {
        final service = create();
        final pending = Completer<void>();
        final oldResponse = Completer<ResponseBody>();
        var refreshes = 0;
        service.dio.httpClientAdapter = SessionAdapter((options) async {
          if (options.path == '/resources/agents') {
            pending.complete();
            return oldResponse.future;
          } else if (options.path == '/auth/refresh') {
            refreshes++;
            return httpResponse(401);
          } else {
            return httpResponse(200, account('new'));
          }
        });
        final request = service.dio.get('/resources/agents');
        final denied = expectLater(request, throwsA(isA<DioException>()));
        await pending.future;
        await service.login('new@example.test', 'synthetic');
        oldResponse.complete(httpResponse(401));
        await denied;
        expect(refreshes, 0);
        expect(service.user?['id'], 'new');
        expect(service.access, 'access-new');
      },
    );

    test(
      '$edition delayed location check cannot send the old capture as the new account',
      () async {
        final service = create();
        service.user!['permissions'] = ['read', 'location.self'];
        final pending = Completer<void>();
        final oldLocation = Completer<ResponseBody>();
        var delayLocation = false;
        final captureAuthorization = <String>[];
        service.dio.httpClientAdapter = SessionAdapter((options) async {
          if (options.path == '/location-tracking/me') {
            if (delayLocation) {
              if (!pending.isCompleted) pending.complete();
              return oldLocation.future;
            }
            return httpResponse(200, {'enabled': false});
          }
          if (options.path.endsWith('/login')) {
            final signedIn = account('new');
            signedIn['user']['permissions'] = ['read', 'location.self'];
            return httpResponse(200, signedIn);
          }
          if (options.path == '/kyc-captures/sale-submissions') {
            captureAuthorization.add(options.headers['Authorization']);
          }
          return httpResponse(200);
        });
        service.workLocation.bindAccount(service.user);
        await service.workLocation.load();
        delayLocation = true;
        final capture = service.dio.post(
          '/kyc-captures/sale-submissions',
          data: {'source_reference': 'old-account-order'},
        );
        final obsolete = expectLater(
          capture,
          throwsA(
            isA<DioException>().having(
              (error) => error.type,
              'type',
              DioExceptionType.cancel,
            ),
          ),
        );
        await pending.future;
        delayLocation = false;
        await service.login('new@example.test', 'synthetic');
        await service.workLocation.load();
        oldLocation.complete(httpResponse(200, {'enabled': false}));
        await obsolete;
        expect(captureAuthorization, isEmpty);
        expect(service.user?['id'], 'new');
        expect(service.access, 'access-new');
      },
    );

    test(
      '$edition late successful response cannot return or cache the previous account data',
      () async {
        final service = create();
        final pending = Completer<void>();
        final oldResponse = Completer<ResponseBody>();
        service.dio.httpClientAdapter = SessionAdapter((options) async {
          if (options.path == '/dashboard') {
            pending.complete();
            return oldResponse.future;
          }
          return httpResponse(200, account('new'));
        });
        final dashboard = service.dashboard();
        final obsolete = expectLater(
          dashboard,
          throwsA(
            isA<DioException>().having(
              (error) => error.type,
              'type',
              DioExceptionType.cancel,
            ),
          ),
        );
        await pending.future;
        await service.login('new@example.test', 'synthetic');
        oldResponse.complete(httpResponse(200, {'customer': 'old customer'}));
        await obsolete;
        expect(service.store.browserMemory, isEmpty);
        expect(service.user?['id'], 'new');
        expect(service.access, 'access-new');
        expect(service.online, isTrue);
      },
    );

    test(
      '$edition previous-account network failure cannot return its cached records',
      () async {
        final service = create();
        service.store.browserMemory['old:all:agents'] = {
          'rows': [
            {'id': 'private-old-agent'},
          ],
        };
        final pending = Completer<void>();
        final oldResponse = Completer<ResponseBody>();
        service.dio.httpClientAdapter = SessionAdapter((options) async {
          if (options.path == '/resources/agents') {
            pending.complete();
            return oldResponse.future;
          }
          return httpResponse(200, account('new'));
        });
        final rows = service.list('agents');
        final obsolete = expectLater(
          rows,
          throwsA(
            isA<DioException>().having(
              (error) => error.type,
              'type',
              DioExceptionType.cancel,
            ),
          ),
        );
        await pending.future;
        await service.login('new@example.test', 'synthetic');
        oldResponse.completeError(
          DioException(
            requestOptions: RequestOptions(path: '/resources/agents'),
            type: DioExceptionType.connectionError,
          ),
        );
        await obsolete;
        expect(service.user?['id'], 'new');
        expect(service.online, isTrue);
      },
    );

    test(
      '$edition late sign-out cleanup preserves the old token and the new account',
      () async {
        final service = create();
        final pending = Completer<void>();
        final oldLogout = Completer<ResponseBody>();
        String? revokedAuthorization;
        service.dio.httpClientAdapter = SessionAdapter((options) async {
          if (options.path == '/auth/logout') {
            revokedAuthorization = options.headers['Authorization'];
            pending.complete();
            return oldLogout.future;
          }
          return httpResponse(200, account('new'));
        });
        final signingOut = service.logout();
        await pending.future;
        await service.login('new@example.test', 'synthetic');
        oldLogout.complete(httpResponse(200));
        await signingOut;
        expect(revokedAuthorization, 'Bearer access-old');
        expect(service.user?['id'], 'new');
        expect(service.access, 'access-new');
        expect(
          await service.store.secure.read(key: service.refreshStorageKey),
          'refresh-new',
        );
      },
    );

    test(
      '$edition an old synchronization cannot overwrite the new account state',
      () async {
        final service = demo
            ? DemoSyncSessionService()
            : NativeSyncSessionService();
        addTearDown(service.dispose);
        service.user = Json.from(account('old')['user']);
        service.access = 'access-old';
        final pending = Completer<void>();
        final oldHealth = Completer<ResponseBody>();
        service.dio.httpClientAdapter = SessionAdapter((options) async {
          if (options.path == '/health' &&
              options.headers['Authorization'] == 'Bearer access-old') {
            pending.complete();
            return oldHealth.future;
          }
          if (options.path.endsWith('/login')) {
            return httpResponse(200, account('new'));
          }
          if (options.path == '/dashboard') {
            return httpResponse(200, {'account': 'new'});
          }
          if (options.path.startsWith('/resources/') ||
              options.path == '/incentives' ||
              options.path == '/support-tickets') {
            return ResponseBody.fromString(
              '[]',
              200,
              headers: {
                Headers.contentTypeHeader: ['application/json'],
              },
            );
          }
          return httpResponse(200);
        });
        final syncingOld = service.sync();
        await pending.future;
        await service.login('new@example.test', 'synthetic');
        expect(service.syncRevision, 1);
        expect(service.store.browserMemory['new:all:dashboard'], {
          'account': 'new',
        });
        oldHealth.completeError(
          DioException(
            requestOptions: RequestOptions(path: '/health'),
            type: DioExceptionType.connectionError,
          ),
        );
        await syncingOld;
        expect(service.user?['id'], 'new');
        expect(service.online, isTrue);
        expect(service.syncing, isFalse);
        expect(service.syncError, isNull);
        expect(service.syncRevision, 1);
      },
    );
  }
}
