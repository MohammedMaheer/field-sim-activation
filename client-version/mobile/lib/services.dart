import 'dart:async';
import 'dart:convert';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:cryptography/cryptography.dart';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path/path.dart' as path;
import 'package:sqflite/sqflite.dart';

import 'package:synchronized/synchronized.dart';
import 'role_access.dart';
import 'location_tracking.dart';
import 'package:uuid/uuid.dart';

typedef Json = Map<String, dynamic>;
const apiUrl = String.fromEnvironment(
  'API_URL',
  defaultValue: 'https://relay-client.187-127-162-233.sslip.io/api',
);
final serviceProvider = ChangeNotifierProvider((ref) => RelayService());
// Sync status changes must not discard mounted content. Explicit refreshes retain
// AsyncValue's previous data, while account changes remain dependency reloads.
RelayService _resourceService(Ref ref) {
  ref.watch(serviceProvider.select((service) => service.user?['id']));
  ref.watch(serviceProvider.select((service) => service.branchId));
  ref.listen<bool>(serviceProvider.select((service) => service.syncing), (
    previous,
    next,
  ) {
    if (previous == true && !next) ref.invalidateSelf();
  });
  return ref.read(serviceProvider);
}

final resourceProvider = FutureProvider.family<List<Json>, String>(
  (ref, resource) => _resourceService(ref).list(resource),
);
final dashboardProvider = FutureProvider<Json>(
  (ref) => _resourceService(ref).dashboard(),
);
final incentiveProvider = FutureProvider<List<Json>>(
  (ref) => _resourceService(ref).proposalList('incentives'),
);
final supportProvider = FutureProvider<List<Json>>(
  (ref) => _resourceService(ref).proposalList('support-tickets'),
);

abstract class PushAdapter {
  Future<bool> registerDevice();
}

class DemoPushAdapter implements PushAdapter {
  @override
  Future<bool> registerDevice() async => false;
}

class OfflineStore {
  final secure = const FlutterSecureStorage();
  final algorithm = AesGcm.with256bits();
  Database? db;
  SecretKey? key;
  final Map<String, Json> browserMemory = {};
  Future<void> initialize() async {
    var encoded = await secure.read(key: 'relay_cache_key');
    if (encoded == null) {
      encoded = base64Encode(
        await (await algorithm.newSecretKey()).extractBytes(),
      );
      await secure.write(key: 'relay_cache_key', value: encoded);
    }
    key = SecretKey(base64Decode(encoded));
    if (!kIsWeb) {
      db = await openDatabase(
        path.join(await getDatabasesPath(), 'relay_cache.db'),
        version: 1,
        onCreate: (db, version) => db.execute(
          'CREATE TABLE cache (id TEXT PRIMARY KEY, payload TEXT NOT NULL)',
        ),
      );
    }
  }

  Future<void> put(String id, Json value) async {
    if (kIsWeb) {
      browserMemory[id] = value;
      return;
    }
    final box = await algorithm.encrypt(
      utf8.encode(jsonEncode(value)),
      secretKey: key!,
    );
    await db!.insert('cache', {
      'id': id,
      'payload': base64Encode(box.concatenation()),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<Json?> get(String id) async {
    if (kIsWeb) return browserMemory[id];
    final rows = await db!.query('cache', where: 'id = ?', whereArgs: [id]);
    if (rows.isEmpty) return null;
    final box = SecretBox.fromConcatenation(
      base64Decode(rows.first['payload'] as String),
      nonceLength: 12,
      macLength: 16,
    );
    return jsonDecode(
          utf8.decode(await algorithm.decrypt(box, secretKey: key!)),
        )
        as Json;
  }

  Future<void> remove(String id) async {
    browserMemory.remove(id);
    await db?.delete('cache', where: 'id = ?', whereArgs: [id]);
  }

  Future<void> clear() async {
    browserMemory.clear();
    await db?.delete('cache');
  }
}

class RelayService extends ChangeNotifier {
  bool get isPreview => false;
  bool get hasAccountPicker => false;
  String get refreshStorageKey => 'relay_refresh';
  Future<List<Json>> signInAccounts() async => [];
  Future<Uint8List?> previewReceipt({String? reference}) async => null;
  Future<Uint8List?> previewIdentity() async => null;
  Future<Uint8List?> previewOrder() async => null;
  final queueLock = Lock();
  final dio = Dio(
    BaseOptions(
      baseUrl: apiUrl,
      connectTimeout: const Duration(seconds: 12),
      receiveTimeout: const Duration(seconds: 20),
    ),
  );
  final store = OfflineStore();
  Json? user;
  String? _branchId;
  String? _branchAccount;
  // A workspace filter only narrows server-authorized data. It is reset when
  // accounts change and is also part of every offline cache identity.
  String? get branchId => _branchAccount == user?['id'] ? _branchId : null;
  void selectBranch(String? value) {
    final normalized = value?.trim();
    _branchId = normalized == null || normalized.isEmpty ? null : normalized;
    _branchAccount = user?['id'];
    notifyListeners();
  }

  Map<String, dynamic> branchQuery([Map<String, dynamic> values = const {}]) =>
      {...values, if (branchId != null) 'branch_id': branchId};
  bool online = true;
  bool ready = false;
  bool syncing = false;
  int syncRevision = 0;
  String? syncError;
  int queued = 0;
  String? access;
  Timer? timer;
  StreamSubscription<List<ConnectivityResult>>? connectivity;
  Future<void>? refreshing;
  final _sessionLock = Lock();
  int _sessionGeneration = 0;
  int? _syncGeneration;
  bool _obsoleteRequest(RequestOptions options) =>
      options.extra['sessionGeneration'] != _sessionGeneration;

  // Sign-out deliberately revokes the captured old token, even if a new
  // sign-in finishes while its remote cleanup is still in flight.
  bool _preservedLogout(RequestOptions options) =>
      options.path == '/auth/logout' &&
      options.extra['preserveAuthorization'] == true;

  DioException _endedSessionRequest(
    RequestOptions options, {
    Response<dynamic>? response,
  }) => DioException(
    requestOptions: options,
    response: response,
    type: DioExceptionType.cancel,
    error: StateError(
      'This request belongs to a sign-in session that has ended',
    ),
  );

  late final WorkLocationController workLocation;
  Future<String>? _workDeviceIdentity;
  Future<String> workDeviceIdentity() => _workDeviceIdentity ??= () async {
    final key = 'qanawat_work_device_$refreshStorageKey';
    var identifier = await store.secure.read(key: key);
    if (identifier == null || identifier.isEmpty) {
      identifier = const Uuid().v4();
      await store.secure.write(key: key, value: identifier);
    }
    return '${isPreview ? 'Qanawat mobile demo' : 'Qanawat mobile app'}:$identifier';
  }();
  RelayService({WorkPositionSource? workPositions}) {
    workLocation = WorkLocationController(
      dio,
      positions: workPositions,
      deviceIdentity: workDeviceIdentity,
    );
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          options.extra.putIfAbsent(
            'sessionGeneration',
            () => _sessionGeneration,
          );
          if (_obsoleteRequest(options) && !_preservedLogout(options)) {
            handler.reject(_endedSessionRequest(options));
            return;
          }
          if (isLocationCaptureRequest(options) &&
              (user?['permissions'] as List? ?? []).contains('location.self')) {
            workLocation.bindAccount(user);
            try {
              await workLocation.ensureCaptureAllowed();
            } catch (error) {
              handler.reject(
                _obsoleteRequest(options)
                    ? _endedSessionRequest(options)
                    : DioException(requestOptions: options, error: error),
              );
              return;
            }
          }
          // The location check can wait for permission, GPS or the network.
          // Never attach the new account's bearer token to the old capture.
          if (_obsoleteRequest(options) && !_preservedLogout(options)) {
            handler.reject(_endedSessionRequest(options));
            return;
          }
          if (access != null &&
              options.extra['preserveAuthorization'] != true) {
            options.headers['Authorization'] = 'Bearer $access';
          }
          options.headers['X-Device-ID'] = 'Qanawat app';
          if (options.method == 'GET' &&
              options.extra['allAuthorizedBranches'] != true &&
              branchId != null &&
              (options.path == '/dashboard' ||
                  options.path.startsWith('/resources/') ||
                  options.path.startsWith('/reports/') ||
                  options.path == '/kyc-captures' ||
                  options.path == '/kyc-captures/leader-confirmations' ||
                  options.path == '/sales-management/sales' ||
                  options.path == '/sales-management/performance' ||
                  options.path == '/sales-management/targets' ||
                  options.path == '/sales-management/feedback' ||
                  options.path == '/sales-management/call-tasks' ||
                  options.path == '/sales-management/call-tasks/summary' ||
                  options.path == '/sales-management/calls' ||
                  options.path == '/commissions/summary' ||
                  options.path == '/field-assets' ||
                  options.path == '/field-assets/requests/list' ||
                  options.path == '/field-assets/report/summary' ||
                  options.path == '/incentives' ||
                  options.path == '/support-tickets')) {
            options.queryParameters.putIfAbsent('branch_id', () => branchId);
          }
          handler.next(options);
        },
        onResponse: (response, handler) {
          final options = response.requestOptions;
          // Authentication has its own generation check before accepting or
          // persisting tokens. Other responses must not populate the new
          // account's mounted views or caches after an account switch.
          if (!options.path.startsWith('/auth/') && _obsoleteRequest(options)) {
            handler.reject(_endedSessionRequest(options, response: response));
            return;
          }
          handler.next(response);
        },
        onError: (error, handler) async {
          if (!error.requestOptions.path.startsWith('/auth/') &&
              _obsoleteRequest(error.requestOptions)) {
            handler.next(
              _endedSessionRequest(
                error.requestOptions,
                response: error.response,
              ),
            );
            return;
          }
          if (error.response?.statusCode == 401 &&
              !error.requestOptions.path.startsWith('/auth/') &&
              error.requestOptions.extra['retried'] != true &&
              error.requestOptions.extra['sessionGeneration'] ==
                  _sessionGeneration) {
            final generation = _sessionGeneration;
            try {
              await refresh();
              if (generation != _sessionGeneration ||
                  user == null ||
                  access == null) {
                handler.next(error);
                return;
              }
              error.requestOptions.headers['Authorization'] = 'Bearer $access';
              error.requestOptions.extra['retried'] = true;
              final retried = await dio.fetch(error.requestOptions);
              if (generation != _sessionGeneration) {
                handler.next(
                  _endedSessionRequest(error.requestOptions, response: retried),
                );
                return;
              }
              handler.resolve(retried);
              return;
            } catch (refreshError) {
              final rejectedSession =
                  refreshError is StateError ||
                  (refreshError is DioException &&
                      [401, 403].contains(refreshError.response?.statusCode));
              // An outage is retryable. A late response from a previous account
              // must never sign out or refresh the new account.
              if (generation == _sessionGeneration && rejectedSession) {
                _sessionGeneration++;
                access = null;
                user = null;
                workLocation.bindAccount(null);
                notifyListeners();
              }
            }
          }
          handler.next(error);
        },
      ),
    );
  }
  Future<void> initialize() async {
    await store.initialize();
    try {
      await refresh();
    } catch (_) {
      user = null;
    }
    ready = true;
    connectivity = Connectivity().onConnectivityChanged.listen((results) async {
      online = !results.contains(ConnectivityResult.none);
      if (online && user != null) await sync();
      notifyListeners();
    });
    timer = Timer.periodic(const Duration(seconds: 20), (_) {
      if (user != null) sync();
    });
    notifyListeners();
  }

  Future<void> login(String email, String password) async {
    await loginRequest('/auth/login', {
      'email': email,
      'password': password,
      'device': 'Flutter field app',
      'native': true,
    });
  }

  /// Native sign-in and the browser sample-account endpoint share the same
  /// session boundary; neither can be restored by an older refresh response.
  Future<void> loginRequest(String endpoint, Json values) async {
    final generation = ++_sessionGeneration;
    refreshing = null;
    final response = await dio.post(endpoint, data: values);
    await _acceptAuthentication(response.data, generation);
    await sync();
    notifyListeners();
  }

  Future<void> _acceptAuthentication(dynamic response, int generation) =>
      _sessionLock.synchronized(() async {
        if (generation != _sessionGeneration) {
          throw StateError('This sign-in session has ended');
        }
        await store.secure.write(
          key: refreshStorageKey,
          value: response['refresh_token'],
        );
        if (generation != _sessionGeneration) {
          throw StateError('This sign-in session has ended');
        }
        access = response['access_token'];
        user = Map<String, dynamic>.from(response['user']);
        workLocation.bindAccount(user);
        notifyListeners();
      });

  Future<void> refresh() {
    if (refreshing != null) return refreshing!;
    late final Future<void> operation;
    operation = _refresh().whenComplete(() {
      if (identical(refreshing, operation)) refreshing = null;
    });
    return refreshing = operation;
  }

  Future<void> _refresh() async {
    final generation = _sessionGeneration;
    final token = await store.secure.read(key: refreshStorageKey);
    if (generation != _sessionGeneration) {
      throw StateError('This sign-in session has ended');
    }
    if (token == null) throw StateError('Sign in required');
    final r = await dio.post('/auth/refresh', data: {'refresh_token': token});
    await _acceptAuthentication(r.data, generation);
  }

  Future<void> logout() async {
    final generation = ++_sessionGeneration;
    refreshing = null;
    final signedOutAccess = access;
    // Initiate the remote end before removing the local session, then stop
    // collection immediately rather than waiting for the network round trip.
    final endingWork = online && workLocation.active
        ? workLocation.end()
        : null;
    workLocation.bindAccount(null);
    try {
      await endingWork;
    } catch (_) {
      // Sign-out remains available if ending the remote work session fails.
      // No further points are collected locally; the server marks them stale.
    }
    try {
      if (online) {
        await dio.post(
          '/auth/logout',
          options: Options(
            headers: {'Authorization': 'Bearer $signedOutAccess'},
            extra: {
              'preserveAuthorization': true,
              'sessionGeneration': generation,
            },
          ),
        );
      }
    } on DioException {
      // Local sign-out must remain available if the network or session expires.
    }
    await _sessionLock.synchronized(() async {
      if (generation != _sessionGeneration) return;
      await store.secure.delete(key: refreshStorageKey);
      await store.clear();
    });
    if (generation != _sessionGeneration) return;
    access = null;
    user = null;
    workLocation.bindAccount(null);
    _branchId = null;
    _branchAccount = null;
    queued = 0;
    notifyListeners();
  }

  Future<List<Json>> list(String resource) async {
    final key = '${user!['id']}:${branchId ?? 'all'}:$resource';
    try {
      final r = await dio.get(
        '/resources/$resource',
        queryParameters: branchQuery(),
      );
      await store.put(key, {'rows': r.data});
      return (r.data as List).map((v) => Map<String, dynamic>.from(v)).toList();
    } on DioException catch (e) {
      if (e.response != null || e.type == DioExceptionType.cancel) rethrow;
      online = false;
      final cached =
          await store.get(key) ??
          (branchId == null
              ? await store.get('${user!['id']}:$resource')
              : null);
      if (cached == null) rethrow;
      return (cached['rows'] as List)
          .map((v) => Map<String, dynamic>.from(v))
          .toList();
    }
  }

  Future<Json> dashboard() async {
    final key = '${user!['id']}:${branchId ?? 'all'}:dashboard';
    try {
      final r = await dio.get('/dashboard');
      final d = Map<String, dynamic>.from(r.data);
      await store.put(key, d);
      return d;
    } on DioException catch (e) {
      if (e.response != null || e.type == DioExceptionType.cancel) rethrow;
      online = false;
      final d =
          await store.get(key) ??
          (branchId == null
              ? await store.get('${user!['id']}:dashboard')
              : null);
      if (d == null) rethrow;
      return d;
    }
  }

  Future<List<Json>> proposalList(String resource) async {
    final key = '${user!['id']}:${branchId ?? 'all'}:$resource';
    try {
      final r = await dio.get('/$resource');
      final rows = (r.data as List)
          .map((v) => Map<String, dynamic>.from(v))
          .toList();
      await store.put(key, {'rows': rows});
      return rows;
    } on DioException catch (e) {
      if (e.response != null || e.type == DioExceptionType.cancel) rethrow;
      online = false;
      final cached =
          await store.get(key) ??
          (branchId == null
              ? await store.get('${user!['id']}:$resource')
              : null);
      if (cached == null) rethrow;
      return (cached['rows'] as List)
          .map((v) => Map<String, dynamic>.from(v))
          .toList();
    }
  }

  Future<void> sync() async {
    final generation = _sessionGeneration;
    if ((syncing && _syncGeneration == generation) || user == null) return;
    final callingRole = [
      'Tele Verification Officer',
      'Welcome Call Officer',
    ].contains(user?['role']);
    if (callingRole
        ? !canVisitMobilePage('/call-work', user)
        : !List<String>.from(user?['permissions'] ?? []).contains('read')) {
      return;
    }
    workLocation.bindAccount(user);
    _syncGeneration = generation;
    syncing = true;
    syncError = null;
    notifyListeners();
    try {
      await dio.get('/health');
      if (generation != _sessionGeneration) return;
      if ([
        'Tele Verification Officer',
        'Welcome Call Officer',
      ].contains(user?['role'])) {
        if (canVisitMobilePage('/call-work', user)) {
          await dio.get('/sales-management/call-tasks');
          if (generation != _sessionGeneration) return;
        }
        if (canVisitMobilePage('/notifications', user)) {
          await dio.get('/notifications');
          if (generation != _sessionGeneration) return;
        }
        online = true;
        return;
      }
      await dashboard();
      if (generation != _sessionGeneration) return;
      await proposalList('incentives');
      if (generation != _sessionGeneration) return;
      await proposalList('support-tickets');
      if (generation != _sessionGeneration) return;
      for (final name in [
        'agents',
        'activations',
        'inventory',
        'ekyc',
        'plans',
      ]) {
        await list(name);
        if (generation != _sessionGeneration) return;
      }
      online = true;
    } catch (e) {
      if (generation == _sessionGeneration) {
        if (e is DioException && e.response == null) online = false;
        syncError = friendlyError(e);
      }
    } finally {
      if (_syncGeneration == generation) {
        syncing = false;
        syncRevision++;
        notifyListeners();
      }
    }
  }

  @override
  void dispose() {
    timer?.cancel();
    connectivity?.cancel();
    workLocation.dispose();
    dio.close();
    super.dispose();
  }
}

String friendlyError(Object error) {
  if (error is WorkLocationException) return error.message;
  if (error is DioException) {
    if (error.type == DioExceptionType.cancel && error.error is StateError) {
      return 'Your sign-in session changed. Open this page again in your current account.';
    }
    if (error.error is WorkLocationException) {
      return (error.error as WorkLocationException).message;
    }
    final data = error.response?.data;
    if (data is Map && data['detail'] is String) return data['detail'];
    if (error.response == null) {
      return 'Connection unavailable. Previously synchronized records remain cached on this device.';
    }
  }
  return 'Could not complete this action. Check the information and try again.';
}
