import 'dart:io';
import 'dart:ui' as ui;
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/location_tracking.dart';
import 'package:relay_agent/relay_theme.dart';
import 'package:relay_agent/services.dart';
import 'package:relay_agent/work_location_screen.dart';

class ScreenWorkPositions implements WorkPositionSource {
  int reads = 0;
  @override
  Future<LocationJson> current({required bool requestPermission}) async {
    reads++;
    return {
      'latitude': 25.2048,
      'longitude': 55.2708,
      'accuracy_m': 5,
      'captured_at': DateTime.now().toUtc().toIso8601String(),
      'mocked': false,
    };
  }
}

class WorkScreenService extends RelayService {
  final bool otherDevice;
  bool active;
  bool failEnd;
  final writes = <String>[];
  WorkScreenService(
    ScreenWorkPositions positions, {
    this.active = false,
    this.otherDevice = false,
    this.failEnd = false,
  }) : super(workPositions: positions) {
    user = {
      'id': 'work-screen-account',
      'name': 'Work Member',
      'role': 'Tele Verification Officer',
      'permissions': ['location.self', 'call.tele.read'],
    };
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          if (options.method == 'POST') writes.add(options.path);
          if (options.path == '/location-tracking/end' && failEnd) {
            handler.reject(
              DioException(
                requestOptions: options,
                response: Response(
                  requestOptions: options,
                  statusCode: 409,
                  data: {'detail': 'Work session changed. Refresh first.'},
                ),
              ),
            );
            return;
          }
          if (options.path == '/location-tracking/start') active = true;
          if (options.path == '/location-tracking/end') active = false;
          handler.resolve(
            Response(
              requestOptions: options,
              statusCode: 200,
              data: {
                'enabled': true,
                'boundary': {
                  'id': 'fence',
                  'name': 'Marina Customer Services Worksite',
                  'latitude': 25.2048,
                  'longitude': 55.2708,
                  'radius_m': 150,
                },
                'work_session': active
                    ? {
                        'id': 'work-session',
                        'device': otherDevice
                            ? 'another-device'
                            : 'Qanawat mobile app:fixed-device',
                      }
                    : null,
                'latest_location': active
                    ? {
                        'state': 'INSIDE',
                        'fresh': true,
                        'latitude': 25.2048,
                        'longitude': 55.2708,
                        'accuracy_m': 5,
                        'captured_at': '2026-10-13T12:30:30Z',
                        'received_at': '2026-10-13T12:30:32Z',
                      }
                    : null,
                'can_capture': active,
                'reason': active ? null : 'Start a work session first.',
              },
            ),
          );
        },
      ),
    );
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    for (final entry in {
      'DM Sans': 'assets/fonts/dmsans.ttf',
      'Manrope': 'assets/fonts/manrope.ttf',
      'MaterialIcons': 'fonts/MaterialIcons-Regular.otf',
    }.entries) {
      await (FontLoader(
        entry.key,
      )..addFont(rootBundle.load(entry.value))).load();
    }
  });
  setUp(
    () => FlutterSecureStorage.setMockInitialValues({
      'qanawat_work_device_relay_refresh': 'fixed-device',
    }),
  );

  for (final scale in [1.0, 2.0]) {
    testWidgets('work location fits a narrow phone with text scale $scale', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(360, 780);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final positions = ScreenWorkPositions();
      final service = WorkScreenService(positions);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [serviceProvider.overrideWith((_) => service)],
          child: MaterialApp(
            theme: relayTheme(),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: TextScaler.linear(scale)),
              child: child!,
            ),
            home: const RepaintBoundary(
              key: ValueKey('work-location-visual'),
              child: WorkLocationScreen(),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Start work session'), findsOneWidget);
      expect(positions.reads, 0);
      expect(tester.takeException(), isNull);
      if (const bool.fromEnvironment('LOCATION_VISUAL')) {
        final boundary = tester.renderObject<RenderRepaintBoundary>(
          find.byKey(const ValueKey('work-location-visual')),
        );
        await tester.runAsync(() async {
          final image = await boundary.toImage();
          final png = await image.toByteData(format: ui.ImageByteFormat.png);
          await File(
            '../output/qa/geofence-mobile-work-location-$scale.png',
          ).writeAsBytes(png!.buffer.asUint8List());
          image.dispose();
        });
      }
      await tester.tap(find.text('Start work session'));
      await tester.pumpAndSettle();
      expect(find.text('End work session'), findsOneWidget);
      expect(positions.reads, 1);
      expect(tester.takeException(), isNull);
      await tester.tap(find.text('End work session'));
      await tester.pumpAndSettle();
      expect(find.text('Start work session'), findsOneWidget);
      expect(service.writes, [
        '/location-tracking/start',
        '/location-tracking/end',
      ]);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }

  testWidgets(
    'another device session is explained and never collects this device GPS',
    (tester) async {
      final positions = ScreenWorkPositions();
      final service = WorkScreenService(
        positions,
        active: true,
        otherDevice: true,
      );
      await tester.pumpWidget(
        ProviderScope(
          overrides: [serviceProvider.overrideWith((_) => service)],
          child: MaterialApp(
            theme: relayTheme(),
            home: const WorkLocationScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('End other device session'), findsOneWidget);
      expect(find.text('Refresh device location'), findsNothing);
      expect(
        find.textContaining('This device is not sharing location.'),
        findsOneWidget,
      );
      await service.workLocation.refreshPosition();
      expect(positions.reads, 0);
      await tester.tap(find.text('End other device session'));
      await tester.pumpAndSettle();
      expect(find.text('Start work session'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  test(
    'failed end does not prevent sign-out or leave local sharing active',
    () async {
      final service = WorkScreenService(
        ScreenWorkPositions(),
        active: true,
        failEnd: true,
      );
      addTearDown(service.dispose);
      service.workLocation.bindAccount(service.user);
      await service.workLocation.load();
      expect(service.workLocation.active, isTrue);
      await service.logout();
      expect(service.writes, ['/location-tracking/end', '/auth/logout']);
      expect(service.user, isNull);
      expect(service.workLocation.active, isFalse);
      expect(service.workLocation.authorized, isFalse);
    },
  );

  test(
    'capture interceptor fails before OCR when work session is missing',
    () async {
      final service = WorkScreenService(ScreenWorkPositions());
      addTearDown(service.dispose);
      await expectLater(
        service.dio.post('/kyc-captures/ocr-jobs', data: {}),
        throwsA(
          predicate(
            (error) => friendlyError(
              error as Object,
            ).contains('Start your work session'),
          ),
        ),
      );
      expect(service.writes, isEmpty);
    },
  );
}
