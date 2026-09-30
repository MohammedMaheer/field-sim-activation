import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/main.dart';
import 'package:relay_agent/services.dart';

class SessionService extends RelayService {
  SessionService() {
    ready = true;
    user = {'id': 'staff-a', 'role': 'Sales Manager', 'name': 'Staff A'};
    dio.interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
      handler.resolve(Response(requestOptions: options, statusCode: 200,
          data: options.path.contains('/performance') ? <String, dynamic>{} : <dynamic>[]));
    }));
  }
  @override
  Future<void> initialize() async {}
  @override
  Future<void> logout() async { user = null; access = null; notifyListeners(); }
  void notifySync() { notifyListeners(); }
}

void main() {
  testWidgets('sign out clears nested private screens and back history; sync retains navigation', (tester) async {
    final service = SessionService();
    await tester.pumpWidget(ProviderScope(overrides: [serviceProvider.overrideWith((ref) => service)], child: const RelayApp()));
    await tester.pumpAndSettle();
    router.push('/sales-management');
    await tester.pumpAndSettle();
    expect(router.canPop(), isTrue);
    service.notifySync();
    await tester.pumpAndSettle();
    expect(router.canPop(), isTrue);
    await tester.tap(find.byTooltip('Sign out').last);
    await tester.pumpAndSettle();
    expect(find.text('Sign in to Relay'), findsOneWidget);
    expect(find.text('Sales management'), findsNothing);
    expect(router.canPop(), isFalse);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
}
