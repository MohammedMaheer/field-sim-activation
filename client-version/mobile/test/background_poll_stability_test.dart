import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/call_work.dart';
import 'package:relay_agent/commission_calculations.dart';
import 'package:relay_agent/field_assets.dart';
import 'package:relay_agent/sales_management.dart';
import 'package:relay_agent/services.dart';

class SlowPollService extends RelayService {
  final counts = <String, int>{};
  final requests = <RequestOptions>[];
  final pending = <(RequestOptions, RequestInterceptorHandler)>[];
  bool hold = false;
  String customer = 'Avery Stone';
  SlowPollService() {
    user = {
      'id': 'poll-account',
      'role': 'Administrator',
      'permissions': ['read', 'compliance.write'],
    };
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          counts.update(options.path, (value) => value + 1, ifAbsent: () => 1);
          requests.add(options);
          if (hold &&
              ![
                '/notifications',
                '/resources/branches',
              ].contains(options.path)) {
            pending.add((options, handler));
          } else {
            respond(options, handler);
          }
        },
      ),
    );
  }

  dynamic data(String path) => switch (path) {
    '/notifications' => {'items': [], 'unread': 0, 'categories': []},
    '/resources/branches' => [
      {'id': 'marina', 'name': 'Marina Branch'},
      {'id': 'downtown', 'name': 'Downtown Branch'},
    ],
    '/sales-management/call-tasks/summary' => {'actionable': 1},
    '/sales-management/call-tasks' => [
      {
        'id': 'call-a',
        'customer_name': customer,
        'stage': 'TELE_VERIFICATION',
        'status': 'PENDING',
        'branch': 'Marina Branch',
        'agent': 'Sales agent',
      },
    ],
    '/sales-management/performance' => {'recorded': 1, 'closed': 1},
    '/commissions/summary' => {
      'rows': [
        {
          'name': customer,
          'role': 'Field Agent',
          'net_sales': 1,
          'cancelled': 0,
          'in_progress': 0,
          'missing_inputs': [],
          'components': [],
        },
      ],
    },
    _ => <dynamic>[],
  };

  void respond(RequestOptions options, RequestInterceptorHandler handler) {
    handler.resolve(
      Response(
        requestOptions: options,
        statusCode: 200,
        data: data(options.path),
      ),
    );
  }

  void release() {
    for (final (options, handler) in pending.toList()) {
      respond(options, handler);
    }
    pending.clear();
  }
}

void main() {
  final cases = <(String, Widget, String, Duration)>[
    (
      'calls',
      const CallWorkScreen(),
      '/sales-management/call-tasks',
      const Duration(seconds: 15),
    ),
    (
      'assets',
      const FieldAssetsScreen(),
      '/field-assets',
      const Duration(seconds: 20),
    ),
    (
      'sales',
      const SalesManagementScreen(),
      '/sales-management/sales',
      const Duration(seconds: 20),
    ),
    (
      'commission',
      const Scaffold(
        body: CommissionCalculations(history: Text('Historical entries')),
      ),
      '/commissions/summary',
      const Duration(seconds: 20),
    ),
  ];
  for (final (name, screen, endpoint, interval) in cases) {
    testWidgets('$name slow background polling never queues a loading reset', (
      tester,
    ) async {
      final service = SlowPollService();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [serviceProvider.overrideWith((ref) => service)],
          child: MaterialApp(home: screen),
        ),
      );
      await tester.pumpAndSettle();
      expect(service.counts[endpoint], 1);
      final list = find.byType(ListView).first;
      final originalElement = tester.element(list);
      service.hold = true;
      await tester.pump(interval);
      await tester.pump();
      expect(service.counts[endpoint], 2);
      // The response takes longer than the poll interval. The next tick must
      // coalesce with the outstanding request rather than create a loud retry.
      await tester.pump(interval);
      await tester.pump();
      expect(service.counts[endpoint], 2);
      expect(tester.element(list), same(originalElement));
      expect(find.byType(CircularProgressIndicator), findsNothing);
      service.customer = 'Updated customer';
      service.release();
      await tester.pump();
      await tester.pump();
      await tester.pump();
      await tester.pumpAndSettle();
      expect(service.counts[endpoint], 2);
      expect(tester.element(list), same(originalElement));
      expect(find.byType(CircularProgressIndicator), findsNothing);
      if (name == 'calls' || name == 'commission') {
        expect(find.text('Updated customer'), findsOneWidget);
      }
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    });
  }

  testWidgets(
    'branch change during a slow call poll still reloads the new scope',
    (tester) async {
      final service = SlowPollService();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [serviceProvider.overrideWith((ref) => service)],
          child: const MaterialApp(home: CallWorkScreen()),
        ),
      );
      await tester.pumpAndSettle();
      service.hold = true;
      await tester.pump(const Duration(seconds: 15));
      await tester.pump();
      service.selectBranch('downtown');
      await tester.pump();
      expect(find.text('Avery Stone'), findsNothing);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      service.release();
      await tester.pump();
      await tester.pump();
      await tester.pump();
      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      final scoped = service.requests
          .where((request) => request.path == '/sales-management/call-tasks')
          .last;
      expect(scoped.queryParameters['branch_id'], 'downtown');
      expect(service.counts['/sales-management/call-tasks'], 3);
      service.hold = false;
      service.release();
      await tester.pumpAndSettle();
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
