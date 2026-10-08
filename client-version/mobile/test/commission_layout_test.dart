import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/commission_calculations.dart';
import 'package:relay_agent/relay_theme.dart';
import 'package:relay_agent/services.dart';

class CommissionService extends RelayService {
  CommissionService({List<Json> policies = const []}) {
    ready = true;
    user = {'id': 'sample-agent', 'role': 'Field Agent'};
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (request, handler) {
          handler.resolve(
            Response(
              requestOptions: request,
              statusCode: 200,
              data: request.path.endsWith('/policies')
                  ? policies
                  : {
                      'rows': [
                        {
                          'name': 'Sample Agent',
                          'role': 'Field Agent',
                          'policy_name': 'MBO Staff',
                          'net_sales': 12,
                          'cancelled': 3,
                          'in_progress': 1,
                          'amount': null,
                          'missing_inputs': ['plan_slabs'],
                          'components': [],
                        },
                      ],
                    },
            ),
          );
        },
      ),
    );
  }
}

final staffPolicy = <String, dynamic>{
  'name': 'MBO staff',
  'valid_from': '2026-10',
  'rules': {
    'bands': [80, 90, 100, 110],
    'monthly_rates': {
      'SLAB_1': ['25', '30', '30', '50'],
      'SLAB_2': ['50', '60', '75', '90'],
      'SLAB_3': ['75', '90', '100', '125'],
    },
    'gate_rates': {
      'GATE_1': {
        'MNP': '50',
        'NEW': '30',
        'P2P': '25',
        'slab3_mrc_percent': '5',
      },
      'GATE_2': {
        'MNP': '60',
        'NEW': '40',
        'P2P': '30',
        'slab3_mrc_percent': '7',
      },
    },
    'notes': [],
  },
};

final managerPolicy = <String, dynamic>{
  'name': 'Sales Manager gates',
  'valid_from': '2026-10',
  'valid_until': '2026-10',
  'rules': {
    'gate_rates': {
      'GATE_1': {'target': 1945, 'MNP': '2.5', 'NEW': '1.75', 'P2P': '0.75'},
      'GATE_2': {'target': 2000, 'MNP': '3', 'NEW': '2.5', 'P2P': '1'},
    },
    'notes': [],
  },
};

Future<void> openPolicy(
  WidgetTester tester,
  Json policy,
  double width,
  double scale,
) async {
  tester.view.physicalSize = Size(width, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        serviceProvider.overrideWith(
          (ref) => CommissionService(policies: [policy]),
        ),
      ],
      child: MaterialApp(
        theme: relayTheme(),
        home: MediaQuery(
          data: MediaQueryData(
            size: Size(width, 900),
            textScaler: TextScaler.linear(scale),
          ),
          child: const Scaffold(
            body: CommissionCalculations(history: Text('Historical entries')),
          ),
        ),
      ),
    ),
  );
  await tester.pump(const Duration(milliseconds: 300));
  await tester.tap(find.text('Rate tables'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('${policy['name']}'));
  await tester.pumpAndSettle();
}

void main() {
  test('monthly incentive period uses Dubai business time', () {
    expect(commissionPeriod(DateTime.utc(2026, 9, 30, 22)), '2026-10');
    expect(commissionAmount({'amount': null}), 'Awaiting configuration');
    expect(commissionAmount({'amount': '125.5'}), 'AED 125.50');
  });
  for (final width in [300.0, 390.0]) {
    for (final scale in [1.0, 2.0]) {
      testWidgets('staff rates have readable units at $width / $scale', (
        tester,
      ) async {
        await openPolicy(tester, staffPolicy, width, scale);
        expect(find.text('Monthly rates'), findsOneWidget);
        expect(find.text('Slab 1'), findsOneWidget);
        expect(find.text('80%'), findsNWidgets(3));
        expect(find.text('AED 125'), findsOneWidget);
        expect(find.text('Gate 1'), findsOneWidget);
        expect(find.textContaining('slab3_mrc_percent'), findsNothing);
        final bonus = find.text('5% of monthly charge');
        await tester.ensureVisible(bonus);
        await tester.pumpAndSettle();
        final labelRect = tester.getRect(find.text('Slab 3 bonus').first);
        final valueRect = tester.getRect(bonus);
        expect(valueRect.left, greaterThanOrEqualTo(labelRect.right + 8));
        expect(valueRect.right, lessThanOrEqualTo(width));
        expect(find.text('7% of monthly charge'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        await tester.pump(const Duration(milliseconds: 100));
      });
      testWidgets('gate-only policy stays compact at $width / $scale', (
        tester,
      ) async {
        await openPolicy(tester, managerPolicy, width, scale);
        expect(find.text('Monthly rates'), findsNothing);
        expect(find.text('Gate 1'), findsOneWidget);
        expect(find.text('1945 sales'), findsOneWidget);
        expect(find.text('AED 2.5'), findsNWidgets(2));
        expect(find.text('AED 0.75'), findsOneWidget);
        await tester.ensureVisible(find.text('2000 sales'));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        await tester.pump(const Duration(milliseconds: 100));
      });
      testWidgets('incentive state stays readable at $width / $scale', (
        tester,
      ) async {
        tester.view.physicalSize = Size(width, 900);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              serviceProvider.overrideWith((ref) => CommissionService()),
            ],
            child: MaterialApp(
              theme: relayTheme(),
              home: MediaQuery(
                data: MediaQueryData(
                  size: Size(width, 900),
                  textScaler: TextScaler.linear(scale),
                ),
                child: const Scaffold(
                  body: CommissionCalculations(
                    history: Text('Historical entries'),
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.pump(const Duration(milliseconds: 100));
        await tester.pump(const Duration(milliseconds: 200));
        expect(find.text('Awaiting configuration'), findsOneWidget);
        expect(find.text('12 net sales'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        await tester.pump(const Duration(milliseconds: 100));
      });
    }
  }
}
