import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/sales_management.dart';
import 'package:relay_agent/services.dart';

class TargetAgentService extends RelayService {
  TargetAgentService() {
    ready = true;
    user = {'id': 'leader-test', 'role': 'Team Leader'};
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
