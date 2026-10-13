import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:geolocator/geolocator.dart';

typedef LocationJson = Map<String, dynamic>;

/// An explicit, signed-in work session. No off-duty or hidden-app collection.
/// The server decides freshness and boundary membership; the device never
/// substitutes a branch centre or sample coordinate for a real GPS reading.
abstract class WorkPositionSource {
  Future<LocationJson> current({required bool requestPermission});
}

class DeviceWorkPositionSource implements WorkPositionSource {
  @override
  Future<LocationJson> current({required bool requestPermission}) async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw const WorkLocationException(
        'Turn on device location services to check your work boundary.',
      );
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied && requestPermission) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.deniedForever) {
      throw WorkLocationException(
        kIsWeb
            ? 'Allow location for this site in your browser settings, then try again.'
            : 'Allow precise location for Qanawat in app settings, then try again.',
      );
    }
    if (![
      LocationPermission.whileInUse,
      LocationPermission.always,
    ].contains(permission)) {
      throw const WorkLocationException(
        'Location permission is required. Your location is shared only during an active work session while Qanawat is open.',
      );
    }
    final position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        timeLimit: Duration(seconds: 20),
      ),
    );
    if (position.isMocked) {
      throw const WorkLocationException(
        'A simulated location cannot be used for work tracking. Use your real device location.',
      );
    }
    return {
      'latitude': position.latitude,
      'longitude': position.longitude,
      'accuracy_m': position.accuracy,
      'captured_at': position.timestamp.toUtc().toIso8601String(),
      'mocked': position.isMocked,
      'device': kIsWeb ? 'Qanawat mobile web demo' : 'Qanawat mobile app',
    };
  }
}

class WorkLocationException implements Exception {
  final String message;
  const WorkLocationException(this.message);
  @override
  String toString() => message;
}

String workLocationError(Object error) {
  if (error is WorkLocationException) return error.message;
  if (error is DioException) {
    final data = error.response?.data;
    if (data is Map && data['detail'] is String) return data['detail'];
    if (error.response == null) {
      return 'Location could not be synchronized. Check your connection and try again.';
    }
  }
  if (error is TimeoutException) {
    return 'A precise location was not available in time. Move to a clear area and try again.';
  }
  return 'Could not check your work location. Check location permission and try again.';
}

bool isLocationCaptureRequest(RequestOptions options) =>
    options.method == 'POST' &&
    (options.path == '/kyc-captures' ||
        options.path == '/kyc-captures/sale-submissions' ||
        options.path == '/kyc-captures/ocr-jobs' ||
        options.path == '/kyc-captures/read-document' ||
        options.path == '/kyc-captures/read-order' ||
        options.path == '/sales-management/sales' ||
        options.path == '/transactions' ||
        options.path == '/kyc-captures/receipt-fields');

class WorkLocationController extends ChangeNotifier
    with WidgetsBindingObserver {
  WorkLocationController(
    this.dio, {
    WorkPositionSource? positions,
    this.deviceIdentity,
    this.pollInterval = const Duration(seconds: 30),
  }) : positions = positions ?? DeviceWorkPositionSource();

  final Dio dio;
  final WorkPositionSource positions;
  final Duration pollInterval;
  final Future<String> Function()? deviceIdentity;
  String? device;
  LocationJson? status;
  String? actorId;
  bool authorized = false;
  bool busy = false;
  bool visible = true;
  String? error;
  Timer? _timer;
  Future<void>? _updating;
  int _generation = 0;
  bool _disposed = false;
  WidgetsBinding? _binding;

  bool get active => status?['work_session'] is Map;
  bool get ownDevice =>
      active && (status!['work_session'] as Map)['device'] == device;
  bool get enabled => status?['enabled'] == true;
  LocationJson? get boundary => status?['boundary'] is Map
      ? Map<String, dynamic>.from(status!['boundary'])
      : null;
  LocationJson? get latest => status?['latest_location'] is Map
      ? Map<String, dynamic>.from(status!['latest_location'])
      : null;
  String get label {
    if (!active) return 'Work location';
    if (!ownDevice) return 'Work session on another device';
    if (!visible) return 'Sharing paused';
    if (error != null) return 'Location needs attention';
    if (latest?['fresh'] != true) return 'Location needs refreshing';
    return latest?['state'] == 'INSIDE'
        ? 'Inside work boundary'
        : latest?['state'] == 'OUTSIDE'
        ? 'Outside work boundary'
        : 'Work location sharing';
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void bindAccount(LocationJson? user) {
    final nextId = user?['id']?.toString();
    final nextAuthorized = (user?['permissions'] as List? ?? []).contains(
      'location.self',
    );
    if (nextId == actorId && nextAuthorized == authorized) return;
    stopLocal();
    actorId = nextId;
    authorized = nextAuthorized;
    if (authorized && nextId != null) {
      if (_binding == null) {
        _binding = WidgetsBinding.instance;
        _binding!.addObserver(this);
        visible =
            _binding!.lifecycleState == null ||
            _binding!.lifecycleState == AppLifecycleState.resumed;
      }
      unawaited(load());
    }
  }

  void stopLocal() {
    _generation++;
    _timer?.cancel();
    _timer = null;
    status = null;
    _updating = null;
    error = null;
    busy = false;
    _notify();
  }

  void _accept(dynamic value, int generation) {
    if (_disposed || generation != _generation || !authorized) return;
    status = Map<String, dynamic>.from(value as Map);
    error = null;
    _timer?.cancel();
    if (active && ownDevice && visible) {
      _timer = Timer.periodic(pollInterval, (_) {
        unawaited(refreshPosition(requestPermission: false));
      });
    }
    _notify();
  }

  Future<void> load() async {
    if (!authorized || actorId == null || _disposed) return;
    final generation = _generation;
    try {
      device ??=
          await (deviceIdentity?.call() ?? Future.value('Qanawat work device'));
      if (generation != _generation) return;
      final response = await dio.get('/location-tracking/me');
      _accept(response.data, generation);
    } catch (exception) {
      if (generation == _generation) {
        error = workLocationError(exception);
        _notify();
      }
    }
  }

  Future<void> start() async {
    if (!authorized || actorId == null) {
      throw const WorkLocationException('Work location access is unavailable.');
    }
    if (busy) return;
    final generation = _generation;
    busy = true;
    error = null;
    _notify();
    try {
      device ??=
          await (deviceIdentity?.call() ?? Future.value('Qanawat work device'));
      if (generation != _generation) return;
      final reading = await positions.current(requestPermission: true);
      if (generation != _generation) return;
      final response = await dio.post(
        '/location-tracking/start',
        data: {...reading, 'device': device},
      );
      _accept(response.data, generation);
    } catch (exception) {
      if (generation == _generation) error = workLocationError(exception);
      rethrow;
    } finally {
      if (generation == _generation) busy = false;
      _notify();
    }
  }

  Future<void> end() async {
    final session = status?['work_session'];
    if (session is! Map) return;
    final generation = _generation;
    busy = true;
    _notify();
    try {
      final response = await dio.post(
        '/location-tracking/end',
        data: {'session_id': session['id']},
      );
      _accept(response.data, generation);
    } catch (exception) {
      if (generation == _generation) error = workLocationError(exception);
      rethrow;
    } finally {
      if (generation == _generation) busy = false;
      _notify();
    }
  }

  Future<void> refreshPosition({bool requestPermission = true}) {
    if (_updating != null) return _updating!;
    final operation = _refreshPosition(requestPermission: requestPermission);
    _updating = operation;
    return operation.whenComplete(() {
      if (identical(_updating, operation)) _updating = null;
    });
  }

  Future<void> _refreshPosition({required bool requestPermission}) async {
    if (!authorized || !active || !ownDevice || !visible || _disposed) return;
    final generation = _generation;
    final sessionId = (status!['work_session'] as Map)['id'];
    try {
      final reading = await positions.current(
        requestPermission: requestPermission,
      );
      if (generation != _generation || !visible || !active) return;
      final response = await dio.post(
        '/location-tracking/points',
        data: {...reading, 'session_id': sessionId, 'device': device},
      );
      _accept(response.data, generation);
    } catch (exception) {
      if (generation == _generation) {
        error = workLocationError(exception);
        _notify();
      }
    }
  }

  Future<void> ensureCaptureAllowed() async {
    if (!authorized) return; // The API independently enforces the policy.
    await load();
    if (status == null || error != null) {
      throw WorkLocationException(error ?? 'Check your work location first.');
    }
    if (!enabled) return;
    if (!active) {
      throw const WorkLocationException(
        'Start your work session in Work location before capturing a sale.',
      );
    }
    if (!ownDevice) {
      throw const WorkLocationException(
        'Your work session is active on another device. End that session in Work location, then start a session on this device.',
      );
    }
    await refreshPosition();
    if (error != null || status?['can_capture'] != true) {
      throw WorkLocationException(
        error ??
            status?['reason'] ??
            'Your work location must be inside the assigned boundary.',
      );
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    visible = state == AppLifecycleState.resumed;
    if (!visible) {
      _timer?.cancel();
      _timer = null;
      _notify();
      return;
    }
    if (authorized) {
      unawaited(
        load().then((_) {
          if (active && ownDevice) {
            return refreshPosition(requestPermission: false);
          }
        }),
      );
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    _generation++;
    _binding?.removeObserver(this);
    super.dispose();
  }
}
