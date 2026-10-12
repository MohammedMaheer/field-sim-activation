import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/sales_management.dart';
import 'package:relay_agent/services.dart';

class TargetAgentService extends RelayService {
  TargetAgentService({String role = 'Team Leader', List<String>? grants}) {
    ready = true;
    user = {
      'id': 'leader-test',
      'role': role,
      if (role == 'Field Agent') 'agent_id': 'active-agent',
      'permissions': grants ?? ['read', 'task.write'],
    };
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          final Object data = options.path.contains('/performance')
              ? <String, dynamic>{}
              : options.path == '/notifications'
              ? {'items': [], 'unread': 0, 'categories': []}
              : options.path == '/resources/agents'
              ? [
                  {
                    'id': 'active-agent',
                    'name': 'Current agent',
                    'employment_status': 'ACTIVE',
                  },
                  {
                    'id': 'exited-agent',
                    'name': 'Former agent',
                    'employment_status': 'EXITED',
                  },
                ]
              : options.path.contains('/targets')
              ? [
                  {
                    'id': 'historical-target',
                    'agent': 'Former agent',
                    'period': '2026-09',
                    'order_type': 'ALL',
                    'daily_target': 10,
                    'monthly_target': 100,
                  },
                ]
              : <dynamic>[];
          handler.resolve(
            Response(requestOptions: options, statusCode: 200, data: data),
          );
        },
      ),
    );
  }
}

void main() {
  testWidgets('target shortcut opens the targets tab immediately', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          serviceProvider.overrideWith((ref) => TargetAgentService()),
        ],
        child: const MaterialApp(home: SalesManagementScreen(initialTab: 2)),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Former agent'), findsOneWidget);
    expect(find.text('Set target'), findsOneWidget);
  });
  testWidgets('target editing follows effective write permission revocation', (
    tester,
  ) async {
    final service = TargetAgentService();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [serviceProvider.overrideWith((ref) => service)],
        child: const MaterialApp(home: SalesManagementScreen()),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Targets'));
    await tester.pumpAndSettle();
    expect(find.text('Set target'), findsOneWidget);
    service.user = {
      ...service.user!,
      'permissions': ['read'],
    };
    service.notifyListeners();
    await tester.pumpAndSettle();
    expect(find.text('Set target'), findsNothing);
    expect(find.text('Former agent'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('sales agent feedback requires its effective capture grant', (
    tester,
  ) async {
    final service = TargetAgentService(
      role: 'Field Agent',
      grants: ['read', 'ekyc.write'],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [serviceProvider.overrideWith((ref) => service)],
        child: const MaterialApp(home: SalesManagementScreen()),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Feedback'));
    await tester.pumpAndSettle();
    expect(find.text('Add feedback'), findsOneWidget);
    service.user = {
      ...service.user!,
      'permissions': ['read'],
    };
    service.notifyListeners();
    await tester.pumpAndSettle();
    expect(find.text('Add feedback'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets(
    'new target picker excludes exited staff while their target history stays visible',
    (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            serviceProvider.overrideWith((ref) => TargetAgentService()),
          ],
          child: const MaterialApp(home: SalesManagementScreen()),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Targets'));
      await tester.pumpAndSettle();
      expect(find.text('Former agent'), findsOneWidget);
      await tester.tap(find.text('Set target'));
      await tester.pumpAndSettle();
      await tester.tap(
        find.widgetWithText(DropdownButtonFormField<String>, 'Sales agent'),
      );
      await tester.pumpAndSettle();
      expect(find.text('Current agent'), findsWidgets);
      expect(find.text('Former agent').hitTestable(), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
