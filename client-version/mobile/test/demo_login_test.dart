import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:dio/dio.dart';
import 'package:relay_agent/main.dart';
import 'package:relay_agent/preview_main.dart';
import 'package:relay_agent/services.dart';

class SignInService extends RelayService {
  SignInService({this.picker = true, this.failCatalog = false});
  final bool picker;
  bool failCatalog;
  final calls = <List<String>>[];
  final rows = <Json>[
    {'email': 'agent1@relay.demo', 'name': 'Agent One', 'role': 'Field Agent'},
    {'email': 'admin@relay.demo', 'name': 'Admin One', 'role': 'Administrator'},
  ];
  @override
  bool get hasAccountPicker => picker;
  @override
  Future<List<Json>> signInAccounts() async {
    if (failCatalog) throw StateError('Catalog unavailable');
    return rows;
  }

  @override
  Future<void> login(String email, String password) async {
    calls.add([email, password]);
  }
}

Widget signIn(SignInService service) => ProviderScope(
  overrides: [serviceProvider.overrideWith((ref) => service)],
  child: const MaterialApp(home: LoginScreen()),
);

void main() {
  test('only the shared browser demo enables account selection', () {
    final native = RelayService(),
        demo = SharedPreviewService(baseUrl: 'https://example.test/api');
    addTearDown(native.dispose);
    addTearDown(demo.dispose);
    expect(native.hasAccountPicker, isFalse);
    expect(demo.hasAccountPicker, isTrue);
    expect(native.refreshStorageKey, 'relay_refresh');
    expect(demo.refreshStorageKey, 'relay_mobile_demo_refresh_v1');
  });

  test(
    'browser demo ignores legacy tokens and rotates its own token',
    () async {
      FlutterSecureStorage.setMockInitialValues({
        'relay_refresh': 'legacy-token',
      });
      final demo = SharedPreviewService(baseUrl: 'https://example.test/api');
      addTearDown(demo.dispose);
      var requests = 0;
      demo.dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) {
            requests++;
            expect(options.path, '/auth/refresh');
            expect(options.data, {'refresh_token': 'demo-token'});
            handler.resolve(
              Response(
                requestOptions: options,
                data: {
                  'access_token': 'demo-access',
                  'refresh_token': 'rotated-demo-token',
                  'user': {'id': 'agent-one', 'role': 'Field Agent'},
                },
              ),
            );
          },
        ),
      );
      await expectLater(demo.refresh(), throwsStateError);
      expect(requests, 0);
      await demo.store.secure.write(
        key: demo.refreshStorageKey,
        value: 'demo-token',
      );
      await demo.refresh();
      expect(requests, 1);
      expect(
        await demo.store.secure.read(key: demo.refreshStorageKey),
        'rotated-demo-token',
      );
      expect(
        await demo.store.secure.read(key: 'relay_refresh'),
        'legacy-token',
      );
      expect(demo.user?['id'], 'agent-one');
    },
  );

  testWidgets(
    'account picker defaults to agent and signs in selected account without password',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final service = SignInService();
      await tester.pumpWidget(signIn(service));
      await tester.pumpAndSettle();
      expect(find.widgetWithText(TextField, 'Password'), findsNothing);
      expect(find.widgetWithText(TextField, 'Work email'), findsNothing);
      final account = find.byType(DropdownButtonFormField<String>);
      expect(
        tester.widget<DropdownButtonFormField<String>>(account).initialValue,
        'agent1@relay.demo',
      );
      await tester.tap(find.text('Sign in to Relay'));
      await tester.pumpAndSettle();
      expect(service.calls.single, ['agent1@relay.demo', '']);
      await tester.tap(account);
      await tester.pumpAndSettle();
      await tester.tap(find.text('admin@relay.demo').last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sign in to Relay'));
      await tester.pumpAndSettle();
      expect(service.calls.last, ['admin@relay.demo', '']);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('catalog failure blocks sign-in and retry restores selection', (
    tester,
  ) async {
    final service = SignInService(failCatalog: true);
    await tester.pumpWidget(signIn(service));
    await tester.pumpAndSettle();
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNull,
    );
    expect(service.calls, isEmpty);
    service.failCatalog = false;
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(find.byType(DropdownButtonFormField<String>), findsOneWidget);
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNotNull,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('normal app keeps its email and password sign-in', (
    tester,
  ) async {
    final service = SignInService(picker: false);
    await tester.pumpWidget(signIn(service));
    await tester.pumpAndSettle();
    expect(find.byType(DropdownButtonFormField<String>), findsNothing);
    final email = find.widgetWithText(TextField, 'Work email');
    final password = find.widgetWithText(TextField, 'Password');
    expect(email, findsOneWidget);
    expect(tester.widget<TextField>(password).obscureText, isTrue);
    await tester.enterText(email, 'staff@example.com');
    await tester.enterText(password, 'test-private-password');
    await tester.ensureVisible(find.text('Sign in to Relay'));
    await tester.tap(find.text('Sign in to Relay'));
    await tester.pumpAndSettle();
    expect(service.calls.single, [
      'staff@example.com',
      'test-private-password',
    ]);
    expect(tester.takeException(), isNull);
  });
}
