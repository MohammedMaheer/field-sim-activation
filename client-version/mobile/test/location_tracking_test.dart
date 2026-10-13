import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/location_tracking.dart';
import 'package:relay_agent/role_access.dart';
import 'package:relay_agent/services.dart';

class TestWorkPositions implements WorkPositionSource {
  int reads = 0;
  Object? failure;
  Completer<LocationJson>? pending;
  @override
  Future<LocationJson> current({required bool requestPermission}) async {
    reads++;
    if (failure != null) throw failure!;
    if (pending != null) return pending!.future;
    return {
      'latitude': 25.2,
      'longitude': 55.3,
      'accuracy_m': 6.0,
      'captured_at': DateTime.now().toUtc().toIso8601String(),
      'mocked': false,
      'device': 'test device',
    };
  }
}

class LocationApiFixture {
  final Dio dio = Dio();
  final positions = TestWorkPositions();
  late final WorkLocationController controller;
  final writes = <RequestOptions>[];
  bool enabled = false;
  bool outside = false;
  bool failLoad = false;
  bool failStart = false;
  bool failEnd = false;
  bool active = false;
  LocationJson get status => {
    'enabled': enabled,
    'boundary': {'id': 'fence', 'name': 'Test worksite', 'radius_m': 100},
    'work_session': active
        ? {'id': 'session-one', 'device': 'Qanawat work device'}
        : null,
    'latest_location': active
        ? {'state': outside ? 'OUTSIDE' : 'INSIDE', 'fresh': true}
        : null,
    'can_start': !outside,
    'can_capture': active && !outside,
    'reason': outside ? 'You are outside your assigned work boundary.' : null,
  };
  LocationApiFixture() {
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          if (options.method == 'POST') writes.add(options);
          final denied =
              (options.path.endsWith('/me') && failLoad) ||
              (options.path.endsWith('/start') && failStart) ||
              (options.path.endsWith('/end') && failEnd);
          if (denied) {
            handler.reject(
              DioException(
                requestOptions: options,
                response: Response(
                  requestOptions: options,
                  statusCode: 403,
                  data: {'detail': 'Your work location could not be verified.'},
                ),
              ),
            );
            return;
          }
          if (options.path.endsWith('/start')) active = true;
          if (options.path.endsWith('/end')) active = false;
          handler.resolve(
            Response(requestOptions: options, statusCode: 200, data: status),
          );
        },
      ),
    );
    controller = WorkLocationController(dio, positions: positions);
    controller.bindAccount({
      'id': 'member-one',
      'permissions': ['location.self'],
    });
  }
  void dispose() {
    controller.dispose();
    dio.close();
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'every known role has own location access only with its effective grant',
    () {
      for (final role in knownRoles) {
        expect(
          canVisitMobilePage('/work-location', {
            'role': role,
            'permissions': ['location.self'],
          }),
          isTrue,
          reason: role,
        );
        expect(
          canVisitMobilePage('/work-location', {
            'role': role,
            'permissions': ['read'],
          }),
          isFalse,
          reason: role,
        );
      }
      expect(canVisitMobilePage('/work-location', null), isFalse);
      expect(
        canVisitMobilePage('/work-location', {
          'role': 'unknown',
          'permissions': ['location.self'],
        }),
        isFalse,
      );
    },
  );

  test(
    'disabled enforcement preserves capture without GPS or work session',
    () async {
      final fixture = LocationApiFixture();
      addTearDown(fixture.dispose);
      await fixture.controller.ensureCaptureAllowed();
      expect(fixture.positions.reads, 0);
      expect(fixture.writes, isEmpty);
    },
  );

  test('enabled capture requires an explicit work session', () async {
    final fixture = LocationApiFixture()..enabled = true;
    addTearDown(fixture.dispose);
    await expectLater(
      fixture.controller.ensureCaptureAllowed(),
      throwsA(isA<WorkLocationException>()),
    );
    expect(fixture.positions.reads, 0);
    expect(fixture.writes, isEmpty);
  });

  test(
    'start uses device position and capture refreshes the actor-bound session',
    () async {
      final fixture = LocationApiFixture()..enabled = true;
      addTearDown(fixture.dispose);
      await fixture.controller.load();
      await fixture.controller.start();
      expect(fixture.controller.active, isTrue);
      expect(fixture.writes.single.data['latitude'], 25.2);
      expect(fixture.writes.single.data['mocked'], isFalse);
      await fixture.controller.ensureCaptureAllowed();
      expect(fixture.positions.reads, 2);
      expect(fixture.writes.last.data['session_id'], 'session-one');
      expect(fixture.writes.last.data.containsKey('user_id'), isFalse);
      await fixture.controller.end();
      expect(fixture.controller.active, isFalse);
    },
  );

  test(
    'outside boundary result blocks capture without pretending the sale succeeded',
    () async {
      final fixture = LocationApiFixture()..enabled = true;
      addTearDown(fixture.dispose);
      await fixture.controller.load();
      await fixture.controller.start();
      fixture.outside = true;
      await expectLater(
        fixture.controller.ensureCaptureAllowed(),
        throwsA(predicate((error) => error.toString().contains('outside'))),
      );
      expect(fixture.writes.last.path, '/location-tracking/points');
    },
  );

  test(
    'failed GPS and failed policy lookup fail closed with useful feedback',
    () async {
      final fixture = LocationApiFixture()..enabled = true;
      addTearDown(fixture.dispose);
      await fixture.controller.load();
      await fixture.controller.start();
      fixture.positions.failure = const WorkLocationException(
        'Allow precise location.',
      );
      await expectLater(
        fixture.controller.ensureCaptureAllowed(),
        throwsA(predicate((error) => error.toString().contains('precise'))),
      );
      expect(fixture.writes.length, 1);
      fixture.failLoad = true;
      await expectLater(
        fixture.controller.ensureCaptureAllowed(),
        throwsA(isA<WorkLocationException>()),
      );
    },
  );

  test(
    'hidden app pauses collection and account switch discards an in-flight reading',
    () async {
      final fixture = LocationApiFixture();
      addTearDown(fixture.dispose);
      await fixture.controller.load();
      await fixture.controller.start();
      fixture.controller.didChangeAppLifecycleState(AppLifecycleState.paused);
      await fixture.controller.refreshPosition();
      expect(fixture.positions.reads, 1);
      fixture.controller.visible = true;
      fixture.positions.pending = Completer<LocationJson>();
      final pending = fixture.controller.refreshPosition();
      await Future<void>.delayed(Duration.zero);
      fixture.controller.bindAccount(null);
      fixture.positions.pending!.complete({'latitude': 1, 'longitude': 1});
      await pending;
      expect(fixture.writes.length, 1);
      expect(fixture.controller.active, isFalse);
    },
  );

  test(
    'server rejects start and failed end remains active rather than inventing success',
    () async {
      final fixture = LocationApiFixture()..failStart = true;
      addTearDown(fixture.dispose);
      await expectLater(
        fixture.controller.start(),
        throwsA(isA<DioException>()),
      );
      expect(fixture.controller.active, isFalse);
      fixture.failStart = false;
      await fixture.controller.start();
      fixture.failEnd = true;
      await expectLater(fixture.controller.end(), throwsA(isA<DioException>()));
      expect(fixture.controller.active, isTrue);
      fixture.controller.bindAccount(null);
      expect(fixture.controller.active, isFalse);
    },
  );

  test(
    'capture path classification protects OCR and submit without blocking review or drafts',
    () {
      for (final path in [
        '/kyc-captures',
        '/kyc-captures/sale-submissions',
        '/kyc-captures/ocr-jobs',
        '/kyc-captures/read-document',
        '/kyc-captures/read-order',
        '/kyc-captures/receipt-fields',
      ]) {
        expect(
          isLocationCaptureRequest(RequestOptions(path: path, method: 'POST')),
          isTrue,
          reason: path,
        );
      }
      for (final path in [
        '/kyc-captures/draft',
        '/kyc-captures/existing/review',
        '/location-tracking/start',
      ]) {
        expect(
          isLocationCaptureRequest(RequestOptions(path: path, method: 'POST')),
          isFalse,
          reason: path,
        );
      }
      expect(
        isLocationCaptureRequest(
          RequestOptions(path: '/kyc-captures', method: 'GET'),
        ),
        isFalse,
      );
    },
  );

  test(
    'service presents work location failures instead of misleading offline errors',
    () {
      expect(
        friendlyError(
          DioException(
            requestOptions: RequestOptions(),
            error: const WorkLocationException('Start your work session.'),
          ),
        ),
        'Start your work session.',
      );
    },
  );
}
