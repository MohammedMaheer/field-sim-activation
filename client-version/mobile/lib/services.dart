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

typedef Json = Map<String, dynamic>;
const apiUrl = String.fromEnvironment(
  'API_URL',
  defaultValue: 'https://relay-client.187-127-162-233.sslip.io/api',
);
final serviceProvider = ChangeNotifierProvider((ref) => RelayService());
final resourceProvider = FutureProvider.family<List<Json>, String>(
  (ref, resource) => ref.watch(serviceProvider).list(resource),
);
final dashboardProvider = FutureProvider<Json>(
  (ref) => ref.watch(serviceProvider).dashboard(),
);
final taskProvider = FutureProvider<List<Json>>(
  (ref) => ref.watch(serviceProvider).proposalList('field-tasks'),
);
final incentiveProvider = FutureProvider<List<Json>>(
  (ref) => ref.watch(serviceProvider).proposalList('incentives'),
);
final supportProvider = FutureProvider<List<Json>>(
  (ref) => ref.watch(serviceProvider).proposalList('support-tickets'),
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
  bool online = true;
  bool ready = false;
  bool syncing = false;
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
      key: 'relay_refresh',
      value: r.data['refresh_token'],
    );
    await sync();
    notifyListeners();
  }

  Future<void> refresh() =>
      refreshing ??= _refresh().whenComplete(() => refreshing = null);
  Future<void> _refresh() async {
    final token = await store.secure.read(key: 'relay_refresh');
    if (token == null) throw StateError('Sign in required');
    final r = await dio.post('/auth/refresh', data: {'refresh_token': token});
    access = r.data['access_token'];
    user = Map<String, dynamic>.from(r.data['user']);
    await store.secure.write(
      key: 'relay_refresh',
      value: r.data['refresh_token'],
    );
  }

  Future<void> logout() async {
    try {
      if (online) await dio.post('/auth/logout');
    } on DioException {
      // Local sign-out must remain available if the network or session expires.
    }
    await store.secure.delete(key: 'relay_refresh');
    await store.clear();
    access = null;
    user = null;
    queued = 0;
    notifyListeners();
  }

  Future<List<Json>> list(String resource) async {
    final key = '${user!['id']}:$resource';
    try {
      final r = await dio.get('/resources/$resource');
      await store.put(key, {'rows': r.data});
      return (r.data as List).map((v) => Map<String, dynamic>.from(v)).toList();
    } on DioException catch (e) {
      if (e.response != null) rethrow;
      online = false;
      final cached = await store.get(key);
      if (cached == null) rethrow;
      return (cached['rows'] as List)
          .map((v) => Map<String, dynamic>.from(v))
          .toList();
    }
  }

  Future<Json> dashboard() async {
    final key = '${user!['id']}:dashboard';
    try {
      final r = await dio.get('/dashboard');
      final d = Map<String, dynamic>.from(r.data);
      await store.put(key, d);
      return d;
    } on DioException catch (e) {
      if (e.response != null) rethrow;
      online = false;
      final d = await store.get(key);
      if (d == null) rethrow;
      return d;
    }
  }

  Future<List<Json>> proposalList(String resource) async {
    final key = '${user!['id']}:$resource';
    try {
      final r = await dio.get('/$resource');
      final rows = (r.data as List)
          .map((v) => Map<String, dynamic>.from(v))
          .toList();
      await store.put(key, {'rows': rows});
      return _pendingTasks(resource, rows);
    } on DioException catch (e) {
      if (e.response != null) rethrow;
      online = false;
      final cached = await store.get(key);
      if (cached == null) rethrow;
      return _pendingTasks(
        resource,
        (cached['rows'] as List)
            .map((v) => Map<String, dynamic>.from(v))
            .toList(),
      );
    }
  }

  Future<List<Json>> _pendingTasks(String resource, List<Json> rows) async {
    if (resource != 'field-tasks') return rows;
    final queued = await store.get('${user!['id']}:task-updates');
    final ids = ((queued?['ids'] ?? []) as List).cast<String>().toSet();
    for (final row in rows) {
      if (ids.contains(row['id'])) row['status'] = 'DONE_PENDING_SYNC';
    }
    return rows;
  }

  Future<void> completeTask(String taskId) async {
    final key = '${user!['id']}:task-updates';
    try {
      await dio.patch('/field-tasks/$taskId', data: {'status': 'DONE'});
    } on DioException catch (e) {
      if (e.response != null) rethrow;
      final queued = await store.get(key);
      final ids = ((queued?['ids'] ?? []) as List).cast<String>().toSet();
      ids.add(taskId);
      await store.put(key, {'ids': ids.toList()});
      online = false;
    }
  }

  Future<void> syncTaskUpdates() async {
    final key = '${user!['id']}:task-updates';
    final queued = await store.get(key);
    final ids = ((queued?['ids'] ?? []) as List).cast<String>();
    if (ids.isEmpty) return;
    final remaining = <String>[];
    for (final id in ids) {
      try {
        await dio.patch('/field-tasks/$id', data: {'status': 'DONE'});
      } on DioException catch (e) {
        if (e.response?.statusCode == 409) {
          // Lost response to a previously completed update.
          continue;
        }
        remaining.add(id);
      }
    }
    if (remaining.isEmpty) {
      await store.remove(key);
    } else {
      await store.put(key, {'ids': remaining});
    }
  }

  Future<void> sync() async {
    if (syncing || user == null) return;
    syncing = true;
    syncError = null;
    notifyListeners();
    try {
      await dio.get('/health');
      await syncTaskUpdates();
      await dashboard();
      await proposalList('field-tasks');
      await proposalList('incentives');
      await proposalList('support-tickets');
      for (final name in ['agents', 'activations', 'inventory', 'ekyc']) {
        await list(name);
      }
      online = true;
    } catch (e) {
      if (e is DioException && e.response == null) online = false;
      syncError = friendlyError(e);
    } finally {
      syncing = false;
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
