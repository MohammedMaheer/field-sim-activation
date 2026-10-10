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
  RelayService() {
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          if (access != null) {
            options.headers['Authorization'] = 'Bearer $access';
          }
          options.headers['X-Device-ID'] = 'Relay Flutter';
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
        onError: (error, handler) async {
          if (error.response?.statusCode == 401 &&
              !error.requestOptions.path.startsWith('/auth/') &&
              error.requestOptions.extra['retried'] != true) {
            try {
              await refresh();
              error.requestOptions.headers['Authorization'] = 'Bearer $access';
              error.requestOptions.extra['retried'] = true;
              handler.resolve(await dio.fetch(error.requestOptions));
              return;
            } catch (_) {
              user = null;
              notifyListeners();
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
    final r = await dio.post(
      '/auth/login',
      data: {
        'email': email,
        'password': password,
        'device': 'Flutter field app',
        'native': true,
      },
    );
    access = r.data['access_token'];
    user = Map<String, dynamic>.from(r.data['user']);
    await store.secure.write(
      key: refreshStorageKey,
      value: r.data['refresh_token'],
    );
    await sync();
    notifyListeners();
  }

  Future<void> refresh() =>
      refreshing ??= _refresh().whenComplete(() => refreshing = null);
  Future<void> _refresh() async {
    final token = await store.secure.read(key: refreshStorageKey);
    if (token == null) throw StateError('Sign in required');
    final r = await dio.post('/auth/refresh', data: {'refresh_token': token});
    access = r.data['access_token'];
    user = Map<String, dynamic>.from(r.data['user']);
    await store.secure.write(
      key: refreshStorageKey,
      value: r.data['refresh_token'],
    );
  }

  Future<void> logout() async {
    try {
      if (online) await dio.post('/auth/logout');
    } on DioException {
      // Local sign-out must remain available if the network or session expires.
    }
    await store.secure.delete(key: refreshStorageKey);
    await store.clear();
    access = null;
    user = null;
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
      if (e.response != null) rethrow;
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
      if (e.response != null) rethrow;
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
      if (e.response != null) rethrow;
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
    if (syncing || user == null) return;
    syncing = true;
    syncError = null;
    notifyListeners();
    try {
      await dio.get('/health');
      if ([
        'Tele Verification Officer',
        'Welcome Call Officer',
      ].contains(user?['role'])) {
        if (canVisitMobilePage('/call-work', user)) {
          await dio.get('/sales-management/call-tasks');
        }
        if (canVisitMobilePage('/notifications', user)) {
          await dio.get('/notifications');
        }
        online = true;
        return;
      }
      await dashboard();
      await proposalList('incentives');
      await proposalList('support-tickets');
      for (final name in [
        'agents',
        'activations',
        'inventory',
        'ekyc',
        'plans',
      ]) {
        await list(name);
      }
      online = true;
    } catch (e) {
      if (e is DioException && e.response == null) online = false;
      syncError = friendlyError(e);
    } finally {
      syncing = false;
      syncRevision++;
      notifyListeners();
    }
  }

  @override
  void dispose() {
    timer?.cancel();
    connectivity?.cancel();
    dio.close();
    super.dispose();
  }
}

String friendlyError(Object error) {
  if (error is DioException) {
    final data = error.response?.data;
    if (data is Map && data['detail'] is String) return data['detail'];
    if (error.response == null) {
      return 'Connection unavailable. Previously synchronized records remain cached on this device.';
    }
  }
  return 'Could not complete this action. Check the information and try again.';
}
