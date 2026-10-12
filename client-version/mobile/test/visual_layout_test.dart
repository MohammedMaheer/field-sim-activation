import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/main.dart' as app;
import 'package:relay_agent/services.dart';
import 'package:relay_agent/role_access.dart';

// Optional visual evidence run. The scoped synthetic API snapshot lives outside Git.
// Run with --dart-define=VISUAL_FIXTURE=../output/qa/mobile-visual-fixture.json.
class MemoryStore extends OfflineStore {
  final values = <String, Json>{};
  @override
  Future<Json?> get(String id) async => values[id];
  @override
  Future<void> put(String id, Json value) async {
    values[id] = value;
  }
}

class VisualService extends RelayService {
  final memoryStore = MemoryStore();
  final missingRequests = <String>[];
  @override
  OfflineStore get store => memoryStore;
  VisualService(Json fixture) {
    ready = true;
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          if (!fixture.containsKey(options.path)) {
            missingRequests.add(options.path);
            handler.reject(
              DioException(
                requestOptions: options,
                error: 'Missing visual fixture: ${options.path}',
              ),
            );
          } else {
            handler.resolve(
              Response(
                requestOptions: options,
                data: fixture[options.path],
                statusCode: 200,
              ),
            );
          }
        },
      ),
    );
  }
  @override
  Future<void> initialize() async {}
  @override
  Future<void> sync() async {}
}

void main() {
  const fixturePath = String.fromEnvironment('VISUAL_FIXTURE');
  testWidgets('render every field app page and useful details', (t) async {
    t.view.physicalSize = const Size(390, 844);
    t.view.devicePixelRatio = 1;
    addTearDown(t.view.resetPhysicalSize);
    addTearDown(t.view.resetDevicePixelRatio);
    for (final entry in {
      'DM Sans': 'assets/fonts/dmsans.ttf',
      'Manrope': 'assets/fonts/manrope.ttf',
      'MaterialIcons': 'fonts/MaterialIcons-Regular.otf',
    }.entries) {
      final loader = FontLoader(entry.key)
        ..addFont(rootBundle.load(entry.value));
      await loader.load();
    }
    final fixture = jsonDecode(File(fixturePath).readAsStringSync()) as Json;
    final service = VisualService(fixture);
    final boundary = GlobalKey();
    await t.pumpWidget(
      ProviderScope(
        overrides: [serviceProvider.overrideWith((ref) => service)],
        child: RepaintBoundary(key: boundary, child: const app.RelayApp()),
      ),
    );
    Future<void> shot(String name) async {
      // Live scanner motion is intentionally continuous. Waiting for every
      // animation to stop would time out before evaluating the capture page.
      for (var frame = 0; frame < 15; frame++) {
        await t.pump(const Duration(milliseconds: 100));
      }
      expect(service.missingRequests, isEmpty, reason: name);
      expect(t.takeException(), isNull, reason: name);
      final target =
          boundary.currentContext!.findRenderObject()! as RenderRepaintBoundary;
      await t.runAsync(() async {
        final image = await target.toImage();
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        final file = File('../output/qa/audit77-mobile-render/$name.png');
        file.parent.createSync(recursive: true);
        file.writeAsBytesSync(bytes!.buffer.asUint8List());
        image.dispose();
      });
    }

    await shot('login');
    service.user = Map<String, dynamic>.from(fixture['user']);
    service.notifyListeners();
    await shot('home');
    await t.drag(find.byType(Scrollable).first, const Offset(0, -650));
    await shot('home-lower');
    for (final tab in ['Activations', 'Stock', 'Profile']) {
      await t.tap(find.text(tab).last);
      await shot(tab.toLowerCase());
    }
    await t.tap(find.text('Stock').last);
    await t.pumpAndSettle();
    final search = find.byType(TextField).first;
    await t.enterText(search, 'DEMO');
    await t.tap(find.text('Home').last);
    await t.pumpAndSettle();
    await t.tap(find.text('Stock').last);
    await t.pumpAndSettle();
    expect(
      find.text('DEMO'),
      findsWidgets,
      reason: 'Stock search survives tab changes',
    );
    await t.binding.handlePopRoute();
    await t.pumpAndSettle();
    expect(
      t.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex,
      0,
      reason: 'System back returns a secondary tab to Home',
    );
    for (final path in [
      '/records',
      '/screenshot-capture',
      '/incentives',
      '/customers',
      '/reports',
      '/support',
      '/sales-management',
      '/assets',
      '/notifications',
      '/drafts',
    ]) {
      if (!canVisitMobilePage(path, service.user)) continue;
      app.router.push(path);
      await shot(path.substring(1));
      if (path == '/incentives') {
        await t.tap(find.text('Rate tables'));
        expect(
          DefaultTabController.of(t.element(find.byType(TabBar))).index,
          1,
        );
        await shot('incentive-rates');
        await t.tap(find.text('History'));
        expect(
          DefaultTabController.of(t.element(find.byType(TabBar))).index,
          2,
        );
        await shot('incentive-history');
      }
      if (((path == '/incentives' &&
                  (fixture['/incentives'] as List).isNotEmpty) ||
              path == '/customers') &&
          find.byType(ListTile).evaluate().isNotEmpty) {
        await t.tap(find.byType(ListTile).first);
        await shot('${path.substring(1)}-details');
        if (path == '/customers') {
          await t.scrollUntilVisible(
            find.widgetWithText(TextButton, 'Close'),
            200,
            scrollable: find.byType(Scrollable).last,
            maxScrolls: 60,
          );
          await shot('customer-history');
          await t.tap(find.widgetWithText(TextButton, 'Close'));
        } else {
          await t.tap(find.byTooltip('Close details'));
        }
        await t.pumpAndSettle();
      }
      if (path == '/support') {
        await t.drag(find.byType(Scrollable).first, const Offset(0, -550));
        await shot('support-history');
        if (find.byType(ListTile).evaluate().isNotEmpty) {
          await Scrollable.ensureVisible(
            t.element(find.byType(ListTile).first),
            alignment: .5,
          );
          await t.pumpAndSettle();
          await t.tap(find.byType(ListTile).first);
          await shot('support-details');
          await t.tap(find.byTooltip('Close details'));
          await t.pumpAndSettle();
        }
      }
      app.router.pop();
      await t.pumpAndSettle();
    }
    await t.pumpWidget(const SizedBox());
  }, skip: fixturePath.isEmpty);
}
