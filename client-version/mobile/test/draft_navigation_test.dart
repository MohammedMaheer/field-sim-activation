import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:relay_agent/kyc_capture.dart';
import 'package:relay_agent/customer_intake.dart';
import 'package:relay_agent/saved_drafts.dart';
import 'package:relay_agent/services.dart';

class DraftMemoryStore extends OfflineStore {
  final values = <String, Json>{};

  @override
  Future<Json?> get(String id) async => values[id];

  @override
  Future<void> put(String id, Json value) async => values[id] = value;

  @override
  Future<void> remove(String id) async => values.remove(id);
}

class DraftNavigationService extends RelayService {
  final memory = DraftMemoryStore();
  final drafts = <Json>[];
  final requests = <String>[];
  final Json? existingCapture;

  @override
  OfflineStore get store => memory;

  DraftNavigationService({bool offline = false, this.existingCapture}) {
    ready = true;
    user = {
      'id': 'agent-test',
      'agent_id': 'agent-test',
      'role': 'Field Agent',
      'permissions': ['read', 'ekyc.write'],
    };
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          requests.add(options.path);
          if (offline &&
              [
                '/kyc-captures/draft',
                '/resources/plans',
              ].contains(options.path)) {
            handler.reject(
              DioException.connectionError(
                requestOptions: options,
                reason: 'No connection',
              ),
            );
            return;
          }
          Object data = <dynamic>[];
          if (existingCapture != null &&
              options.path == '/kyc-captures/${existingCapture!['id']}') {
            data = existingCapture!;
          } else if (options.path == '/kyc-captures') {
            data = existingCapture == null ? <dynamic>[] : [existingCapture];
          } else if (options.path == '/kyc-captures/saved-drafts') {
            if (options.method == 'POST') {
              final values = <String, dynamic>{
                // The real Intake response serializes uncaptured images as empty strings.
                'document_image': '',
                'order_image': '',
                'selfie_image': '',
                'payment_image': '',
                ...Map<String, dynamic>.from(options.data['data']),
              };
              final id = values['saved_draft_id'] ?? 'draft-${drafts.length}';
              values['saved_draft_id'] = id;
              final row = {'id': id, 'data': values};
              drafts.removeWhere((draft) => draft['id'] == id);
              drafts.add(row);
              data = row;
            } else {
              data = drafts;
            }
          } else if (options.path == '/kyc-captures/draft') {
            data = {'version': 0, 'data': <String, dynamic>{}};
          }
          handler.resolve(
            Response(requestOptions: options, statusCode: 200, data: data),
          );
        },
      ),
    );
  }
}

Future<void> waitFor(WidgetTester tester, Finder finder) async {
  for (var attempt = 0; attempt < 30; attempt++) {
    await tester.pump(const Duration(milliseconds: 100));
    if (finder.evaluate().isNotEmpty) {
      await tester.pump(const Duration(milliseconds: 500));
      return;
    }
  }
  fail('Missing $finder');
}

GoRouter draftRouter(String location) => GoRouter(
  initialLocation: location,
  routes: [
    GoRoute(
      path: '/',
      builder: (_, _) => const Scaffold(body: Text('Workspace home')),
    ),
    GoRoute(path: '/drafts', builder: (_, _) => const SavedDraftsScreen()),
    GoRoute(
      path: '/transaction/:id',
      builder: (_, state) =>
          KycCaptureScreen(captureId: state.pathParameters['id']),
    ),
    GoRoute(
      path: '/screenshot-capture',
      builder: (_, state) => KycCaptureScreen(
        initial: state.extra is Map
            ? Map<String, dynamic>.from(state.extra as Map)
            : const {},
      ),
    ),
  ],
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    final font = FontLoader('DM Sans')
      ..addFont(rootBundle.load('assets/fonts/dmsans.ttf'));
    await font.load();
  });
  testWidgets(
    'saved draft New and Resume return to Drafts on Android back and preserve values',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final service = DraftNavigationService();
      final router = draftRouter('/screenshot-capture');
      addTearDown(router.dispose);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [serviceProvider.overrideWith((ref) => service)],
          child: MaterialApp.router(
            routerConfig: router,
            theme: ThemeData(fontFamily: 'DM Sans'),
          ),
        ),
      );
      final name = find.widgetWithText(TextFormField, 'Full name');
      await waitFor(tester, name);
      expect(find.byTooltip('Back'), findsOneWidget);
      await tester.ensureVisible(name);
      await tester.enterText(name, 'Saved navigation customer');
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.tap(find.text('Save draft'));
      await waitFor(tester, find.text('Drafts'));
      expect(
        service.drafts.single['data']['name'],
        'Saved navigation customer',
      );
      expect(router.canPop(), isFalse);

      await tester.tap(find.byTooltip('New transaction'));
      await waitFor(tester, name);
      expect(router.canPop(), isTrue);
      expect(tester.widget<TextFormField>(name).initialValue, isEmpty);
      expect(find.byTooltip('Back'), findsOneWidget);
      await tester.binding.handlePopRoute();
      await waitFor(tester, find.text('Drafts'));
      expect(find.text('Saved navigation customer'), findsOneWidget);

      await tester.tap(find.text('Saved navigation customer'));
      await waitFor(tester, name);
      expect(router.canPop(), isTrue);
      expect(
        tester.widget<TextFormField>(name).initialValue,
        'Saved navigation customer',
      );
      await tester.drag(find.byType(ListView).first, const Offset(0, -350));
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Selfie · optional'), findsOneWidget);
      expect(find.text('Selfie saved'), findsNothing);
      await tester.binding.handlePopRoute();
      await waitFor(tester, find.text('Drafts'));
      expect(
        service.drafts.single['data']['name'],
        'Saved navigation customer',
      );

      await tester.binding.handlePopRoute();
      await waitFor(tester, find.text('Workspace home'));
      expect(router.canPop(), isFalse);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets('pushed Drafts pops normally on Android back', (tester) async {
    final router = draftRouter('/');
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          serviceProvider.overrideWith((ref) => DraftNavigationService()),
        ],
        child: MaterialApp.router(
          routerConfig: router,
          theme: ThemeData(fontFamily: 'DM Sans'),
        ),
      ),
    );
    await waitFor(tester, find.text('Workspace home'));
    router.push('/drafts');
    await waitFor(tester, find.text('Drafts'));
    expect(router.canPop(), isTrue);
    await tester.binding.handlePopRoute();
    await waitFor(tester, find.text('Workspace home'));
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('direct customer capture Back returns to Home', (tester) async {
    final router = draftRouter('/screenshot-capture');
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          serviceProvider.overrideWith((ref) => DraftNavigationService()),
        ],
        child: MaterialApp.router(
          routerConfig: router,
          theme: ThemeData(fontFamily: 'DM Sans'),
        ),
      ),
    );
    await waitFor(tester, find.text('New transaction'));
    expect(router.canPop(), isFalse);
    await tester.tap(find.byTooltip('Back'));
    await waitFor(tester, find.text('Workspace home'));
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('resumed order draft opens camera for absent order image', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final service = DraftNavigationService();
    final router = draftRouter('/');
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [serviceProvider.overrideWith((ref) => service)],
        child: MaterialApp.router(
          routerConfig: router,
          theme: ThemeData(fontFamily: 'DM Sans'),
        ),
      ),
    );
    await waitFor(tester, find.text('Workspace home'));
    final image = base64Encode(
      (await rootBundle.load('assets/demo/identity.png')).buffer.asUint8List(),
    );
    router.push(
      '/screenshot-capture',
      extra: {
        'name': 'Saved order customer',
        'step': 1,
        'document_check': 'validated-document',
        'document_image': image,
        'order_image': '',
        'selfie_image': '',
        'payment_image': '',
      },
    );
    await waitFor(tester, find.text('Scan order'));
    expect(find.byType(IntakeCamera), findsOneWidget);
    expect(find.text('Document captured'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('resumed draft preserves captured customer and selfie images', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final router = draftRouter('/');
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          serviceProvider.overrideWith((ref) => DraftNavigationService()),
        ],
        child: MaterialApp.router(
          routerConfig: router,
          theme: ThemeData(fontFamily: 'DM Sans'),
        ),
      ),
    );
    await waitFor(tester, find.text('Workspace home'));
    final image = base64Encode(
      (await rootBundle.load('assets/demo/identity.png')).buffer.asUint8List(),
    );
    router.push(
      '/screenshot-capture',
      extra: {
        'name': 'Saved captured customer',
        'document_check': 'validated-document',
        'document_image': image,
        'selfie_image': image,
        'order_image': '',
        'payment_image': '',
      },
    );
    await waitFor(tester, find.text('Document captured'));
    expect(find.byType(IntakeCamera), findsNothing);
    await tester.drag(find.byType(ListView).first, const Offset(0, -350));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Selfie saved'), findsOneWidget);
    expect(find.text('Selfie · optional'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('offline saved order draft keeps its step and cached plan', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final service = DraftNavigationService(offline: true);
    await service.store.put('agent-test:plans', {
      'rows': [
        {'id': 'cached-plan', 'name': 'Cached subscriber plan'},
      ],
    });
    final router = draftRouter('/');
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [serviceProvider.overrideWith((ref) => service)],
        child: MaterialApp.router(
          routerConfig: router,
          theme: ThemeData(fontFamily: 'DM Sans'),
        ),
      ),
    );
    await waitFor(tester, find.text('Workspace home'));
    final image = base64Encode(
      (await rootBundle.load('assets/demo/identity.png')).buffer.asUint8List(),
    );
    router.push(
      '/screenshot-capture',
      extra: {
        'saved_draft_id': 'saved-order',
        'name': 'Saved offline customer',
        'step': 1,
        'document_check': 'validated-document',
        'document_image': image,
        'order_image': '',
        'selfie_image': '',
        'plan_id': 'cached-plan',
      },
    );
    await waitFor(tester, find.text('Saved details loaded. Check connection.'));
    expect(find.text('Scan order'), findsOneWidget);
    expect(find.byType(IntakeCamera), findsOneWidget);
    expect(service.requests, contains('/resources/plans'));
    final plan = tester.widget<DropdownButtonFormField<String>>(
      find.byType(DropdownButtonFormField<String>).last,
    );
    expect(plan.initialValue, 'cached-plan');
    expect(find.text('Cached subscriber plan'), findsWidgets);
    expect(service.online, isFalse);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
    'New from verified receipt opens clean capture and both Back actions preserve receipt',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final service = DraftNavigationService(
        existingCapture: {
          'id': 'existing-capture',
          'source_reference': 'PAY-EXISTING',
          'document_kind': 'PAYMENT_CONFIRMATION',
          'status': 'VERIFIED',
          'created_at': '2026-10-07',
          'rows': <dynamic>[],
          'intake': {
            'capture_mode': 'SCREENSHOT_ORDER',
            'name': 'Previous customer',
            'document_number': 'SAMPLE-ID-OLD',
            'order_reference': 'OLDREQ',
            'document_image': 'captured-old',
          },
        },
      );
      final router = draftRouter('/transaction/existing-capture');
      addTearDown(router.dispose);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [serviceProvider.overrideWith((ref) => service)],
          child: MaterialApp.router(
            routerConfig: router,
            theme: ThemeData(fontFamily: 'DM Sans'),
          ),
        ),
      );
      await waitFor(tester, find.text('New'));
      await tester.tap(find.text('New'));
      final name = find.widgetWithText(TextFormField, 'Full name');
      await waitFor(tester, name);
      expect(tester.widget<TextFormField>(name).initialValue, isEmpty);
      expect(find.text('Previous customer'), findsNothing);
      expect(find.text('Transaction unavailable'), findsNothing);
      expect(find.text('Document captured'), findsNothing);
      expect(find.byType(IntakeCamera), findsOneWidget);
      expect(router.canPop(), isTrue);
      await tester.tap(find.byTooltip('Back'));
      await waitFor(tester, find.text('New'));
      expect(
        router.routeInformationProvider.value.uri.path,
        '/transaction/existing-capture',
      );
      expect(find.text('Previous customer'), findsWidgets);
      expect(find.text('Transaction unavailable'), findsNothing);
      await tester.tap(find.text('New'));
      await waitFor(tester, name);
      expect(tester.widget<TextFormField>(name).initialValue, isEmpty);
      expect(find.text('Document captured'), findsNothing);
      await tester.binding.handlePopRoute();
      await waitFor(tester, find.text('New'));
      expect(
        router.routeInformationProvider.value.uri.path,
        '/transaction/existing-capture',
      );
      expect(find.text('Previous customer'), findsWidgets);
      expect(find.text('Transaction unavailable'), findsNothing);
      expect(service.existingCapture!['intake']['name'], 'Previous customer');
      expect(
        service.existingCapture!['intake']['document_image'],
        'captured-old',
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
