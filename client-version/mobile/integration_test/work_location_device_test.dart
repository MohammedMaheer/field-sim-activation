import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:integration_test/integration_test.dart';
import 'package:relay_agent/main.dart' as app;
import 'package:relay_agent/services.dart';
import 'package:relay_agent/location_tracking.dart';
import 'package:relay_agent/work_location_screen.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'physical device GPS connects shift, capture gate and management',
    (tester) async {
      const expected = String.fromEnvironment('TEST_API_URL');
      const password = String.fromEnvironment('TEST_PASSWORD');
      expect(expected, isNotEmpty);
      expect(apiUrl, expected);
      expect(Uri.parse(expected).host, anyOf('127.0.0.1', 'localhost'));
      expect(password, isNotEmpty);
      Future<void> wait(Finder finder) async {
        for (var i = 0; i < 160; i++) {
          await tester.pump(const Duration(milliseconds: 200));
          expect(tester.takeException(), isNull);
          if (finder.evaluate().isNotEmpty) return;
        }
        throw TestFailure('Missing $finder');
      }

      app.main();
      await wait(find.byType(app.Gate));
      final service = ProviderScope.containerOf(
        tester.element(find.byType(app.Gate)),
      ).read(serviceProvider);
      for (var i = 0; i < 150 && !service.ready; i++) {
        await tester.pump(const Duration(milliseconds: 200));
      }
      expect(service.ready, isTrue);
      if (service.user != null) await tester.runAsync(service.logout);
      await tester.runAsync(() => service.login('agent1@relay.demo', password));
      final manager = Dio(BaseOptions(baseUrl: expected));
      String? fenceId;
      try {
        await tester.runAsync(() async {
          final login = await manager.post(
            '/auth/login',
            data: {
              'email': 'admin@relay.demo',
              'password': password,
              'native': true,
            },
          );
          manager.options.headers['Authorization'] =
              'Bearer ${login.data['access_token']}';
          await manager.patch(
            '/location-tracking/settings',
            data: {'enabled': false},
          );
        });
        // Real OS permission and GPS are used. No injected coordinates or mock provider.
        final position = await tester.runAsync(
          () => DeviceWorkPositionSource().current(requestPermission: true),
        );
        expect(position, isNotNull);
        expect(position!['mocked'], isFalse);
        expect(position['accuracy_m'], lessThanOrEqualTo(100));
        final branch = service.user!['branch_id'];
        final body = {
          'name': 'Physical isolated worksite',
          'branch_id': branch,
          'latitude': position['latitude'],
          'longitude': position['longitude'],
          'radius_m': 5000,
          'enabled': true,
        };
        await tester.runAsync(() async {
          final existing =
              ((await manager.get('/location-tracking/fences')).data as List)
                  .where((row) => row['branch_id'] == branch);
          final response = existing.isEmpty
              ? await manager.post('/location-tracking/fences', data: body)
              : await manager.patch(
                  '/location-tracking/fences/${existing.first['id']}',
                  data: body,
                );
          fenceId = response.data['id'];
          await manager.patch(
            '/location-tracking/settings',
            data: {'enabled': true},
          );
          await service.workLocation.load();
        });
        app.router.push('/work-location');
        await wait(find.byType(WorkLocationScreen));
        await wait(find.text('Start work session'));
        await tester.tap(find.text('Start work session'));
        await wait(find.text('End work session'));
        expect(service.workLocation.status?['can_capture'], isTrue);
        await tester.runAsync(service.workLocation.ensureCaptureAllowed);
        await binding.convertFlutterSurfaceToImage();
        await tester.pump(const Duration(milliseconds: 200));
        await binding.takeScreenshot('geofence80-device-inside');
        // Move only the disposable fence; the phone remains at its real GPS position.
        await tester.runAsync(() async {
          await manager.patch(
            '/location-tracking/fences/$fenceId',
            data: {...body, 'latitude': (position['latitude'] as num) + 0.2},
          );
          await service.workLocation.load();
          await service.workLocation.refreshPosition();
        });
        await tester.pump(const Duration(milliseconds: 300));
        expect(service.workLocation.latest?['state'], 'OUTSIDE');
        expect(service.workLocation.status?['can_capture'], isFalse);
        var blocked = false;
        await tester.runAsync(() async {
          try {
            await service.workLocation.ensureCaptureAllowed();
          } on WorkLocationException catch (error) {
            blocked = error.message.toLowerCase().contains('outside');
          }
          final members =
              (await manager.get('/location-tracking/members')).data['items']
                  as List;
          final current = members.singleWhere(
            (row) => row['user_id'] == service.user!['id'],
          );
          expect(current['latest_location']['state'], 'OUTSIDE');
          final csv = await manager.get(
            '/location-tracking/export',
            queryParameters: {'format': 'csv', 'user_id': service.user!['id']},
            options: Options(responseType: ResponseType.bytes),
          );
          expect(utf8.decode(csv.data as List<int>), contains('OUTSIDE'));
        });
        expect(blocked, isTrue);
        await binding.takeScreenshot('geofence80-device-outside');
        await tester.tap(find.text('End work session'));
        await wait(find.text('Start work session'));
        await tester.tap(find.text('Start work session'));
        await wait(
          find.textContaining('outside your assigned work boundary').first,
        );
        expect(service.workLocation.active, isFalse);
        expect(tester.takeException(), isNull);
      } finally {
        await tester.runAsync(() async {
          await manager.patch(
            '/location-tracking/settings',
            data: {'enabled': false},
          );
          if (service.workLocation.active) await service.workLocation.end();
          if (fenceId != null) {
            final existing =
                (await manager.get('/location-tracking/fences')).data as List;
            final row = existing.singleWhere((row) => row['id'] == fenceId);
            await manager.patch(
              '/location-tracking/fences/$fenceId',
              data: {
                'name': row['name'],
                'branch_id': row['branch_id'],
                'latitude': row['latitude'],
                'longitude': row['longitude'],
                'radius_m': row['radius_m'],
                'enabled': false,
              },
            );
          }
          await service.logout();
          manager.close();
        });
      }
    },
    timeout: const Timeout(Duration(minutes: 5)),
  );
}
