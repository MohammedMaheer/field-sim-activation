import 'dart:async';
import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:relay_agent/customer_intake.dart';
import 'package:relay_agent/kyc_capture.dart';
import 'package:relay_agent/relay_theme.dart';
import 'package:relay_agent/saved_drafts.dart';
import 'package:relay_agent/services.dart';

class _Memory extends OfflineStore {
  final values = <String, Json>{};
  @override
  Future<Json?> get(String id) async => values[id];
  @override
  Future<void> put(String id, Json value) async => values[id] = value;
  @override
  Future<void> remove(String id) async => values.remove(id);
}

class _Service extends RelayService {
  final memory = _Memory();
  final outcomes = <Json>[];
  bool rejectNext = false;
  Completer<void>? release;
  int draftVersion = 4;
  Json? existing;
  @override
  OfflineStore get store => memory;
  @override
  bool get isPreview => true;
  @override
  Future<List<Json>> list(String resource) async => [
    {'id': 'plan-one', 'name': 'Plan One'},
  ];

  _Service() {
    ready = true;
    user = {
      'id': 'member-one',
      'agent_id': 'agent-one',
      'role': 'Field Agent',
      'permissions': ['read', 'ekyc.write'],
    };
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          dynamic data = <dynamic>[];
          if (options.path == '/kyc-captures/customer-backed-out') {
            outcomes.add(Map<String, dynamic>.from(options.data));
            if (release != null) await release!.future;
            if (rejectNext) {
              rejectNext = false;
              handler.reject(
                DioException.connectionError(
                  requestOptions: options,
                  reason: 'Offline',
                ),
              );
              return;
            }
            data = {
              'recorded': true,
              'already_recorded': false,
              'feedback_id': 'feedback-one',
              'transaction_id': options.data['transaction_id'],
              'version': draftVersion + 1,
              'status': 'CUSTOMER_BACKED_OUT',
            };
          } else if (options.path == '/kyc-captures/draft') {
            if (options.method == 'PUT') draftVersion++;
            data = {'version': draftVersion, 'data': <String, dynamic>{}};
          } else if (options.path == '/kyc-captures') {
            data = existing == null ? <dynamic>[] : [existing];
          } else if (existing != null &&
              options.path == '/kyc-captures/${existing!['id']}') {
            data = existing;
          }
          handler.resolve(
            Response(requestOptions: options, statusCode: 200, data: data),
          );
        },
      ),
    );
  }
}

Future<void> _wait(WidgetTester tester, Finder finder) async {
  for (var index = 0; index < 30; index++) {
    await tester.pump(const Duration(milliseconds: 100));
    if (finder.evaluate().isNotEmpty) {
      await tester.pump(const Duration(milliseconds: 300));
      return;
    }
  }
  fail('Missing $finder');
}

Future<GoRouter> _open(
  WidgetTester tester,
  _Service service,
  Json initial, {
  String? captureId,
  double width = 390,
  double scale = 1,
}) async {
  tester.view.physicalSize = Size(width, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final router = GoRouter(
    initialLocation: '/capture',
    routes: [
      GoRoute(
        path: '/capture',
        builder: (_, _) =>
            KycCaptureScreen(initial: initial, captureId: captureId),
      ),
      GoRoute(
        path: '/sales-management',
        builder: (_, state) =>
            Scaffold(body: Text('Sales ${state.uri.queryParameters['tab']}')),
      ),
      GoRoute(
        path: '/',
        builder: (_, _) => const Scaffold(body: Text('Home')),
      ),
    ],
  );
  addTearDown(router.dispose);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [serviceProvider.overrideWith((ref) => service)],
      child: MaterialApp.router(
        routerConfig: router,
        theme: relayTheme(),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: TextScaler.linear(scale)),
          child: child!,
        ),
      ),
    ),
  );
  return router;
}

Future<void> _openOutcome(WidgetTester tester) async {
  await _wait(tester, find.byTooltip('Transaction options'));
  await tester.tap(find.byTooltip('Transaction options'));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 500));
  await tester.tap(find.text('Customer backed out'));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 500));
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    for (final entry in {
      'DM Sans': 'dmsans.ttf',
      'Manrope': 'manrope.ttf',
    }.entries) {
      await (FontLoader(
        entry.key,
      )..addFont(rootBundle.load('assets/fonts/${entry.value}'))).load();
    }
  });

  for (final step in [0, 1]) {
    testWidgets(
      'records an unfinished stage $step once and clears only its drafts',
      (tester) async {
        final service = _Service();
        final initial = <String, dynamic>{
          'transaction_id': 'attempt-one',
          'saved_draft_id': 'saved-one',
          'name': 'Partial customer',
          'order_type': 'HW',
          'package_name': 'Home Wireless',
          'msisdn': '0500000000',
          'step': step,
          if (step == 1) 'document_check': 'checked',
        };
        service.memory.values.addAll({
          'intake-member-one': {'data': initial},
          'kyc-draft-member-one': {'intake': initial},
          'saved-capture-drafts-member-one': {
            'rows': [
              {'id': 'saved-one', 'pending': true, 'data': initial},
              {
                'id': 'saved-two',
                'data': {
                  'transaction_id': 'attempt-two',
                  'name': 'Keep this draft',
                },
              },
            ],
          },
        });
        final router = await _open(
          tester,
          service,
          initial,
          width: 320,
          scale: 1.15,
        );
        await _openOutcome(tester);
        await tester.enterText(
          find.widgetWithText(TextField, 'Note · optional'),
          'Needs more time',
        );
        FocusManager.instance.primaryFocus?.unfocus();
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 500));
        service.release = Completer<void>();
        final submit = find.widgetWithText(
          FilledButton,
          'Record customer backed out',
        );
        await tester.ensureVisible(submit);
        await tester.tap(submit);
        await tester.tap(submit);
        await tester.pump(const Duration(milliseconds: 100));
        expect(service.outcomes, hasLength(1));
        await tester.binding.handlePopRoute();
        await tester.pump(const Duration(milliseconds: 100));
        expect(find.text('Recording…'), findsOneWidget);
        service.release!.complete();
        await _wait(tester, find.text('Sales feedback'));
        expect(
          router.routeInformationProvider.value.uri.queryParameters['tab'],
          'feedback',
        );
        expect(service.outcomes.single, containsPair('version', 4));
        expect(service.outcomes.single, containsPair('agent_id', 'agent-one'));
        expect(
          service.outcomes.single,
          containsPair('note', 'Needs more time'),
        );
        expect(
          service.outcomes.single['data'],
          containsPair('name', 'Partial customer'),
        );
        expect(
          service.outcomes.single['data'],
          containsPair('order_type', 'HW'),
        );
        expect(service.memory.values['intake-member-one'], isNull);
        expect(service.memory.values['kyc-draft-member-one'], isNull);
        final kept =
            service.memory.values['saved-capture-drafts-member-one']!['rows']
                as List;
        expect(kept, hasLength(1));
        expect(kept.single['id'], 'saved-two');
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
      },
    );
  }

  testWidgets(
    'cancel and offline failure retain fields; retry uses the same attempt',
    (tester) async {
      final service = _Service()..rejectNext = true;
      await _open(tester, service, {
        'transaction_id': 'retry-attempt',
        'name': 'Retained customer',
      });
      await _openOutcome(tester);
      await tester.tap(find.text('Keep editing'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      expect(service.outcomes, isEmpty);
      expect(
        tester
            .widget<TextFormField>(
              find.widgetWithText(TextFormField, 'Full name'),
            )
            .initialValue,
        'Retained customer',
      );
      await _openOutcome(tester);
      await tester.tap(find.text('Record customer backed out'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      expect(find.textContaining('Your draft is kept here'), findsOneWidget);
      expect(find.byType(CustomerIntakeScreen), findsOneWidget);
      await tester.tap(find.text('Record customer backed out'));
      await _wait(tester, find.text('Sales feedback'));
      expect(service.outcomes, hasLength(2));
      expect(
        service.outcomes[0]['transaction_id'],
        service.outcomes[1]['transaction_id'],
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'review carries active draft version and omits image uploads in outcome',
    (tester) async {
      final service = _Service();
      final image = base64Encode(
        (await rootBundle.load(
          'assets/demo/identity.png',
        )).buffer.asUint8List(),
      );
      await _open(tester, service, {
        'transaction_id': 'review-attempt',
        'step': 1,
        'document_check': 'customer-proof',
        'document_image': image,
        'order_check': 'order-proof',
        'order_image': image,
        'name': 'Review customer',
        'order_type': 'NEW',
        'order_reference': 'ORDER-1',
        'plan_id': 'plan-one',
        'package_name': 'Plan One',
        'msisdn': '0500000000',
      });
      await _wait(tester, find.text('Continue'));
      await tester.tap(find.text('Continue'));
      await _wait(tester, find.text('Review & submit sale'));
      await _openOutcome(tester);
      await tester.tap(find.text('Record customer backed out'));
      await _wait(tester, find.text('Sales feedback'));
      expect(service.outcomes.single['version'], 5);
      final details = service.outcomes.single['data'] as Map;
      expect(details['order_reference'], 'ORDER-1');
      expect(details.containsKey('document_image'), isFalse);
      expect(details.containsKey('order_image'), isFalse);
      expect(details.containsKey('order_check'), isFalse);
      expect(service.memory.values['kyc-draft-member-one'], isNull);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets('a changed account cannot record the previous customer attempt', (
    tester,
  ) async {
    final service = _Service();
    await _open(tester, service, {
      'transaction_id': 'previous-account-attempt',
      'name': 'Previous account customer',
    });
    await _openOutcome(tester);
    service.user = {
      ...service.user!,
      'id': 'member-two',
      'agent_id': 'agent-two',
    };
    await tester.tap(find.text('Record customer backed out'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    expect(service.outcomes, isEmpty);
    expect(find.textContaining('Your sign-in session changed'), findsOneWidget);
    await tester.tap(find.text('Keep editing'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(milliseconds: 100));
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'operations account without explicit sales agent keeps the draft',
    (tester) async {
      final service = _Service();
      service.user = {
        ...service.user!,
        'role': 'Operations Manager',
        'agent_id': null,
      };
      await _open(tester, service, {
        'transaction_id': 'unassigned-attempt',
        'name': 'Unassigned customer',
      });
      await _openOutcome(tester);
      await tester.tap(find.text('Record customer backed out'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      expect(service.outcomes, isEmpty);
      expect(find.textContaining('No sales agent is assigned'), findsOneWidget);
      await tester.tap(find.text('Keep editing'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      expect(
        tester
            .widget<TextFormField>(
              find.widgetWithText(TextFormField, 'Full name'),
            )
            .initialValue,
        'Unassigned customer',
      );
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(milliseconds: 100));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('accepted sale and unresolved submission cannot be backed out', (
    tester,
  ) async {
    final service = _Service();
    service.existing = {
      'id': 'accepted',
      'source_reference': 'ORDER-ACCEPTED',
      'status': 'SUBMITTED',
      'created_at': '2026-10-15',
      'document_kind': 'PAYMENT_CONFIRMATION',
      'rows': <dynamic>[],
      'intake': {
        'capture_mode': 'SCREENSHOT_SALE',
        'name': 'Accepted customer',
      },
    };
    await _open(tester, service, {}, captureId: 'accepted');
    await _wait(tester, find.text('Reference bill'));
    expect(find.byTooltip('Transaction options'), findsNothing);
    expect(find.text('Customer backed out'), findsNothing);
    await tester.pumpWidget(const SizedBox());

    final pending = _Service();
    pending.memory.values['kyc-draft-member-one'] = {
      'pending': true,
      'operation': 'pending-operation',
      'intakeReady': true,
      'intakeVersion': 4,
      'intake': {
        'transaction_id': 'pending-attempt',
        'capture_mode': 'SCREENSHOT_SALE',
      },
    };
    await _open(tester, pending, {});
    await _wait(tester, find.text('Review & submit sale'));
    expect(find.byTooltip('Transaction options'), findsNothing);
    expect(pending.outcomes, isEmpty);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });

  test(
    'delayed draft cleanup preserves a newer current and saved transaction',
    () async {
      final service = _Service();
      service.memory.values.addAll({
        'intake-member-one': {
          'data': {'transaction_id': 'new-attempt'},
        },
        'kyc-draft-member-one': {
          'intake': {'transaction_id': 'new-attempt'},
        },
        'saved-capture-drafts-member-one': {
          'rows': [
            {
              'id': 'same-saved-id',
              'data': {'transaction_id': 'new-attempt'},
            },
          ],
        },
      });
      await removeClosedCaptureDrafts(service, {
        'transaction_id': 'old-attempt',
        'saved_draft_id': 'same-saved-id',
      });
      expect(service.memory.values['intake-member-one'], isNotNull);
      expect(service.memory.values['kyc-draft-member-one'], isNotNull);
      expect(
        service.memory.values['saved-capture-drafts-member-one']!['rows'],
        hasLength(1),
      );
    },
  );
}
