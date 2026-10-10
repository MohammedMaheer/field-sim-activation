import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/reports.dart';
import 'package:relay_agent/product_targets.dart';
import 'package:relay_agent/customer_details.dart';
import 'package:relay_agent/relay_theme.dart';
import 'package:relay_agent/services.dart';

class WorkspaceService extends RelayService {
  final requests = <RequestOptions>[];
  WorkspaceService() {
    user = {
      'id': 'workspace-account',
      'role': 'Administrator',
      'permissions': ['read', 'report.read'],
    };
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          requests.add(options);
          handler.resolve(
            Response(
              requestOptions: options,
              statusCode: 200,
              data: options.path == '/resources/branches'
                  ? [
                      {'id': 'marina', 'name': 'Marina Branch'},
                      {'id': 'downtown', 'name': 'Downtown Branch'},
                    ]
                  : [
                      {'id': 'sale', 'order_type': 'ELIFE', 'status': 'CLOSED'},
                    ],
            ),
          );
        },
      ),
    );
  }
}

void main() {
  for (final width in [300.0, 390.0]) {
    for (final scale in [1.0, 2.0]) {
      testWidgets(
        'date range reports stay arranged at $width / $scale and branch refreshes scope',
        (tester) async {
          tester.view.physicalSize = Size(width, 844);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          final service = WorkspaceService();
          await tester.pumpWidget(
            ProviderScope(
              overrides: [serviceProvider.overrideWith((ref) => service)],
              child: MaterialApp(
                theme: relayTheme(),
                builder: (context, child) => MediaQuery(
                  data: MediaQuery.of(
                    context,
                  ).copyWith(textScaler: TextScaler.linear(scale)),
                  child: child!,
                ),
                home: const Scaffold(body: ReportsScreen()),
              ),
            ),
          );
          await tester.pumpAndSettle();
          final request = service.requests.firstWhere(
            (row) => row.path == '/sales-management/sales',
          );
          expect(
            request.queryParameters['from_date'],
            reportDate(reportToday()),
          );
          expect(request.queryParameters['to_date'], reportDate(reportToday()));
          service.selectBranch('marina');
          await tester.pumpAndSettle();
          expect(service.requests.last.queryParameters['branch_id'], 'marina');
          expect(find.text('Excel'), findsOneWidget);
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox());
        },
      );
      testWidgets(
        'all product targets and customer history remain readable at $width / $scale',
        (tester) async {
          tester.view.physicalSize = Size(width, 844);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          await tester.pumpWidget(
            MaterialApp(
              theme: relayTheme(),
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(
                  context,
                ).copyWith(textScaler: TextScaler.linear(scale)),
                child: child!,
              ),
              home: Scaffold(
                body: Builder(
                  builder: (context) => ListView(
                    children: [
                      const ProductTargets(
                        performance: {
                          'daily_targets_by_product': [
                            {'order_type': 'HW', 'target': 3},
                          ],
                        },
                      ),
                      TextButton(
                        onPressed: () => showCustomerDetails(context, {
                          'name': 'Customer with captured evidence',
                          'sr_number': 'SR-CUSTOMER-000123',
                          'details': {
                            'date_of_birth': '1996-09-08',
                            'issue_date': '2021-10-07',
                          },
                          'history': [
                            {
                              'status': 'CLOSED',
                              'activation_label': 'Fully activated',
                              'plan_name':
                                  'Long subscriber package with all monthly benefits',
                              'sr_number': 'SR-000123',
                            },
                          ],
                        }),
                        child: const Text('Open customer'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();
          expect(find.text('Home Wireless'), findsOneWidget);
          expect(find.text('Not set'), findsWidgets);
          await tester.scrollUntilVisible(find.text('Open customer'), 160);
          await tester.pumpAndSettle();
          await tester.tap(find.text('Open customer'));
          await tester.pumpAndSettle();
          await tester.scrollUntilVisible(
            find.text('1996-09-08'),
            160,
            scrollable: find.byType(Scrollable).last,
          );
          await tester.pumpAndSettle();
          expect(find.text('1996-09-08'), findsOneWidget);
          await tester.scrollUntilVisible(
            find.text('SR-CUSTOMER-000123'),
            160,
            scrollable: find.byType(Scrollable).last,
          );
          await tester.pumpAndSettle();
          expect(find.text('SR-CUSTOMER-000123'), findsOneWidget);
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox());
        },
      );
    }
  }
}
