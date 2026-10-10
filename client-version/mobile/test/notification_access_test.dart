import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/notifications.dart';
import 'package:relay_agent/call_work.dart';
import 'package:relay_agent/services.dart';

class NotificationAccessService extends RelayService {
  int inboxReads = 0;
  final requests = <String>[];
  NotificationAccessService() {
    user = {
      'id': 'caller',
      'role': 'Tele Verification Officer',
      'permissions': ['call.tele.write'],
    };
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          requests.add(options.path);
          if (options.path == '/notifications') inboxReads++;
          handler.resolve(
            Response(
              requestOptions: options,
              statusCode: 200,
              data: options.path == '/notifications'
                  ? {'items': [], 'unread': 1, 'categories': []}
                  : {},
            ),
          );
        },
      ),
    );
  }
  void grantInbox(bool canRead) {
    user = {
      ...user!,
      'permissions': ['call.tele.write', if (canRead) 'call.tele.read'],
    };
    notifyListeners();
  }
}

void main() {
  testWidgets(
    'bell hides and stops inbox requests when effective read access is revoked',
    (tester) async {
      final service = NotificationAccessService();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [serviceProvider.overrideWith((ref) => service)],
          child: const MaterialApp(home: Scaffold(body: NotificationBell())),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byTooltip('Notifications'), findsNothing);
      expect(service.inboxReads, 0);
      service.grantInbox(true);
      await tester.pumpAndSettle();
      for (var i = 0; i < 4; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(find.byTooltip('Notifications'), findsOneWidget);
      expect(service.inboxReads, 1);
      service.grantInbox(false);
      await tester.pumpAndSettle();
      expect(find.byTooltip('Notifications'), findsNothing);
      await tester.pump(const Duration(seconds: 25));
      expect(service.inboxReads, 1);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
  testWidgets(
    'direct inbox screen denies writer-only accounts without fetching data',
    (tester) async {
      final service = NotificationAccessService();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [serviceProvider.overrideWith((ref) => service)],
          child: const MaterialApp(home: NotificationsScreen()),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.text('Notifications are not available for your role'),
        findsOneWidget,
      );
      expect(service.inboxReads, 0);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
  testWidgets('writer-only call queue does not fetch tasks or branch choices', (
    tester,
  ) async {
    final service = NotificationAccessService();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [serviceProvider.overrideWith((ref) => service)],
        child: const MaterialApp(home: CallWorkScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      find.text('Calling access is not available for your role'),
      findsOneWidget,
    );
    expect(service.requests, isEmpty);
    expect(find.byTooltip('Notifications'), findsNothing);
    await tester.pump(const Duration(seconds: 16));
    expect(service.requests, isEmpty);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
  test(
    'caller synchronization does not fetch inbox without a read grant',
    () async {
      final service = NotificationAccessService();
      await service.sync();
      expect(service.inboxReads, 0);
      service.grantInbox(true);
      await service.sync();
      expect(service.inboxReads, 1);
      service.dispose();
    },
  );
}
