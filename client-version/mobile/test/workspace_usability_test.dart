import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:relay_agent/field_assets.dart';
import 'package:relay_agent/reports.dart';
import 'package:relay_agent/relay_theme.dart';
import 'package:relay_agent/services.dart';
import 'package:relay_agent/workspace_menu.dart';

class UsabilityService extends RelayService {
  final requests = <RequestOptions>[];
  UsabilityService({String role = 'Field Agent'}) {
    ready = true;
    user = {
      'id': 'usability-member',
      'agent_id': 'agent-1',
      'role': role,
      'permissions': [
        'read',
        'report.read',
        'inventory.self',
        'ekyc.write',
        'location.self',
      ],
    };
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          requests.add(options);
          final data = options.path == '/resources/branches'
              ? [
                  {'id': 'marina', 'name': 'Marina Branch'},
                  {'id': 'downtown', 'name': 'Downtown Branch'},
                ]
              : options.path == '/field-assets'
              ? [
                  {
                    'id': 'asset-1',
                    'label': 'Branch tablet',
                    'branch': 'Marina',
                    'serial': 'DEMO-1',
                    'status': 'ASSIGNED',
                  },
                ]
              : options.path == '/field-assets/requests/list'
              ? [
                  {
                    'id': 'request-1',
                    'category': 'UNIFORM',
                    'quantity': 1,
                    'reason': 'Replacement uniform',
                    'urgency': 'NORMAL',
                    'status': 'REQUESTED',
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
  test(
    'every existing workspace destination remains available in the menu catalogue',
    () {
      expect(workspacePages.map((page) => page.path).toSet(), {
        '/sales-management',
        '/work-location',
        '/records',
        '/transactions',
        '/call-work',
        '/stock',
        '/customers',
        '/reports',
        '/incentives',
        '/assets',
        '/support',
        '/drafts',
      });
    },
  );
  for (final width in [320.0, 390.0]) {
    for (final scale in [1.0, 2.0]) {
      testWidgets(
        'grouped workspace menu keeps role access and support navigation at $width/$scale',
        (tester) async {
          tester.view.physicalSize = Size(width, 844);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          final service = UsabilityService();
          final router = GoRouter(
            routes: [
              GoRoute(
                path: '/',
                builder: (_, _) => Scaffold(
                  appBar: AppBar(actions: const [WorkspaceMenu()]),
                  body: const Text('Home'),
                ),
              ),
              GoRoute(
                path: '/support',
                builder: (_, _) =>
                    const Scaffold(body: Text('Support destination')),
              ),
            ],
          );
          await tester.pumpWidget(
            ProviderScope(
              overrides: [serviceProvider.overrideWith((ref) => service)],
              child: MaterialApp.router(
                theme: relayTheme(),
                routerConfig: router,
                builder: (context, child) => MediaQuery(
                  data: MediaQuery.of(
                    context,
                  ).copyWith(textScaler: TextScaler.linear(scale)),
                  child: child!,
                ),
              ),
            ),
          );
          await tester.tap(find.byTooltip('Workspace pages'));
          await tester.pumpAndSettle();
          expect(find.text('Workspace'), findsOneWidget);
          expect(find.text('Sales & customers'), findsOneWidget);
          expect(find.text('Call work queue'), findsNothing);
          // Revoked permissions disappear while the sheet is still open.
          service.user = {
            ...service.user!,
            'permissions': ['read', 'inventory.self'],
          };
          service.notifyListeners();
          await tester.pumpAndSettle();
          expect(find.text('Reports'), findsNothing);
          await tester.scrollUntilVisible(
            find.text('Support'),
            200,
            scrollable: find.byType(Scrollable).last,
          );
          await tester.tap(find.text('Support'));
          await tester.pumpAndSettle();
          expect(find.text('Support destination'), findsOneWidget);
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox());
          router.dispose();
        },
      );
    }
  }
  testWidgets(
    'assets and requests are separate without losing data or exports',
    (tester) async {
      final service = UsabilityService();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [serviceProvider.overrideWith((ref) => service)],
          child: MaterialApp(
            theme: relayTheme(),
            home: const FieldAssetsScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Branch tablet'), findsOneWidget);
      expect(find.text('Replacement uniform · NORMAL'), findsNothing);
      await tester.tap(find.text('Requests').first);
      await tester.pumpAndSettle();
      expect(find.text('Branch tablet'), findsNothing);
      expect(find.text('Replacement uniform · NORMAL'), findsOneWidget);
      expect(find.text('Export stock requests'), findsOneWidget);
      await tester.tap(find.text('Assets'));
      await tester.pumpAndSettle();
      expect(find.text('Branch tablet'), findsOneWidget);
      expect(find.text('Export branch assets'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
  testWidgets(
    'report date shortcuts send the exact reporting period and preserve branch scope',
    (tester) async {
      final service = UsabilityService();
      service.selectBranch('marina');
      await tester.pumpWidget(
        ProviderScope(
          overrides: [serviceProvider.overrideWith((ref) => service)],
          child: MaterialApp(
            theme: relayTheme(),
            home: const Scaffold(body: ReportsScreen()),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('This month'));
      await tester.pumpAndSettle();
      var query = service.requests
          .lastWhere((request) => request.path == '/sales-management/sales')
          .queryParameters;
      final today = reportToday();
      expect(
        query['from_date'],
        reportDate(DateTime(today.year, today.month, 1)),
      );
      expect(query['to_date'], reportDate(today));
      expect(query['branch_id'], 'marina');
      await tester.tap(find.text('Today'));
      await tester.pumpAndSettle();
      query = service.requests
          .lastWhere((request) => request.path == '/sales-management/sales')
          .queryParameters;
      expect(query['from_date'], reportDate(today));
      expect(query['to_date'], reportDate(today));
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
