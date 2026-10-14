import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/final_incentives.dart';
import 'package:relay_agent/commission_calculations.dart';
import 'package:relay_agent/services.dart';
import 'package:relay_agent/relay_theme.dart';

class CommissionService extends RelayService {
  int reads = 0;
  int estimateReads = 0;
  bool fail = false, empty = false, hold = false;
  final requests = <RequestOptions>[];
  final pending = <(RequestOptions, RequestInterceptorHandler)>[];
  CommissionService() {
    user = {
      'id': 'synthetic-agent',
      'role': 'Field Agent',
      'name': 'Synthetic agent',
      'permissions': ['read'],
    };
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          requests.add(options);
          if (options.path.startsWith('/incentives/final')) {
            reads++;
            if (hold) {
              pending.add((options, handler));
              return;
            }
            if (fail) {
              handler.reject(
                DioException(
                  requestOptions: options,
                  response: Response(
                    requestOptions: options,
                    statusCode: 503,
                    data: {'detail': 'Temporarily unavailable'},
                  ),
                  type: DioExceptionType.badResponse,
                ),
              );
              return;
            }
            handler.resolve(
              Response(
                requestOptions: options,
                statusCode: 200,
                data: empty
                    ? []
                    : [
                        {
                          'id': 'one',
                          'name': 'Synthetic agent',
                          'role': 'Field Agent',
                          'amount': '125.25',
                          'earned_on': '2026-10-13',
                          'branch': 'Synthetic branch with a long name',
                          'team_leader': 'Synthetic team leader',
                          'reference': 'Approved test reference',
                          'note': 'Final amount from imported commission file',
                        },
                      ],
              ),
            );
          } else {
            if (options.path == '/commissions/summary') estimateReads++;
            handler.resolve(
              Response(
                requestOptions: options,
                statusCode: 200,
                data: options.path == '/commissions/summary'
                    ? {'rows': []}
                    : [],
              ),
            );
          }
        },
      ),
    );
  }
  void tick() {
    syncRevision++;
    notifyListeners();
  }
}

Future<void> openScreen(
  WidgetTester tester,
  CommissionService service, {
  bool tabs = false,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [serviceProvider.overrideWith((ref) => service)],
      child: MaterialApp(
        theme: relayTheme(),
        home: Scaffold(
          body: tabs
              ? const CommissionCalculations(
                  finals: FinalIncentiveHistory(),
                  history: Text('Earlier synthetic records'),
                )
              : const FinalIncentiveHistory(),
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump();
}

void main() {
  testWidgets(
    'Final commissions is the default and estimates load only when selected',
    (tester) async {
      final service = CommissionService();
      await openScreen(tester, service, tabs: true);
      await tester.pumpAndSettle();
      expect(find.text('Your final commissions'), findsOneWidget);
      expect(find.text('Final commissions'), findsOneWidget);
      expect(find.text('Rate tables'), findsNothing);
      expect(service.estimateReads, 0);
      await tester.tap(find.text('Estimates'));
      await tester.pumpAndSettle();
      expect(service.estimateReads, 1);
      expect(find.text('Estimated commissions'), findsOneWidget);
      await tester.tap(find.text('Earlier records'));
      await tester.pumpAndSettle();
      expect(find.text('Earlier synthetic records'), findsOneWidget);
      expect(
        find.textContaining('excluded from Final commissions totals'),
        findsOneWidget,
      );
      await tester.pump(const Duration(seconds: 20));
      expect(service.estimateReads, 1);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'Today and This month request precise ranges and show final record total',
    (tester) async {
      final service = CommissionService();
      await openScreen(tester, service);
      await tester.pumpAndSettle();
      final current = DateTime.now()
          .toUtc()
          .add(const Duration(hours: 4))
          .toIso8601String()
          .substring(0, 10);
      expect(
        Uri.parse(
          service.requests
              .firstWhere((r) => r.path.startsWith('/incentives/final'))
              .path,
        ).queryParameters['from_date'],
        '${current.substring(0, 7)}-01',
      );
      expect(find.text('Final commission total'), findsOneWidget);
      expect(find.text('AED 125.25'), findsNWidgets(2));
      await tester.tap(find.text('Today'));
      await tester.pumpAndSettle();
      final todayRequest = Uri.parse(
        service.requests.last.path,
      ).queryParameters;
      expect(todayRequest['from_date'], current);
      expect(todayRequest['to_date'], current);
      await tester.tap(find.text('This month'));
      await tester.pumpAndSettle();
      expect(
        Uri.parse(service.requests.last.path).queryParameters['from_date'],
        '${current.substring(0, 7)}-01',
      );
      expect(find.textContaining(current), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'Empty and failed final requests never suggest a zero commission payout',
    (tester) async {
      final service = CommissionService()..empty = true;
      await openScreen(tester, service);
      await tester.pumpAndSettle();
      expect(
        find.text('No final commissions in this date range'),
        findsOneWidget,
      );
      expect(find.text('AED 0.00'), findsNothing);
      service.fail = true;
      await tester.tap(find.text('Today'));
      await tester.pumpAndSettle();
      expect(
        find.text('Final commissions could not be loaded.'),
        findsOneWidget,
      );
      expect(find.text('Try again'), findsOneWidget);
      expect(find.text('Final commission total'), findsNothing);
      expect(find.text('AED 0.00'), findsNothing);
      service.fail = false;
      service.empty = false;
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();
      expect(find.text('Final commission total'), findsOneWidget);
      expect(find.text('Synthetic agent'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'Changing accounts clears the previous final commission records immediately',
    (tester) async {
      final service = CommissionService();
      await openScreen(tester, service);
      await tester.pumpAndSettle();
      expect(find.text('Synthetic agent'), findsOneWidget);
      service.hold = true;
      service.user = {...service.user!, 'id': 'different-agent'};
      service.tick();
      await tester.pump();
      expect(find.text('Synthetic agent'), findsNothing);
      expect(find.text('Final commission total'), findsNothing);
      expect(find.text('Loading final commissions…'), findsOneWidget);
      for (
        var attempt = 0;
        service.pending.isEmpty && attempt < 20;
        attempt++
      ) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      expect(service.pending, isNotEmpty);
      for (final (options, handler) in service.pending) {
        handler.resolve(
          Response(requestOptions: options, statusCode: 200, data: []),
        );
      }
      await tester.pumpAndSettle();
      expect(
        find.text('No final commissions in this date range'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets('Loading does not display a total until actual amounts arrive', (
    tester,
  ) async {
    final service = CommissionService()..hold = true;
    await openScreen(tester, service);
    expect(find.text('Loading final commissions…'), findsOneWidget);
    expect(find.text('Final commission total'), findsNothing);
    expect(find.text('AED 0.00'), findsNothing);
    for (var attempt = 0; service.pending.isEmpty && attempt < 20; attempt++) {
      await tester.pump(const Duration(milliseconds: 10));
    }
    expect(service.pending, hasLength(1));
    for (final (options, handler) in service.pending) {
      handler.resolve(
        Response(requestOptions: options, statusCode: 200, data: []),
      );
    }
    await tester.pumpAndSettle();
    expect(
      find.text('No final commissions in this date range'),
      findsOneWidget,
    );
    await tester.pumpWidget(const SizedBox());
  });

  for (final scale in [1.0, 2.0]) {
    testWidgets(
      'final amounts remain legible and background refresh retains rows at $scale',
      (tester) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final service = CommissionService();
        await tester.pumpWidget(
          ProviderScope(
            overrides: [serviceProvider.overrideWith((ref) => service)],
            child: MaterialApp(
              theme: relayTheme(),
              home: MediaQuery(
                data: MediaQueryData(
                  size: const Size(390, 844),
                  textScaler: TextScaler.linear(scale),
                ),
                child: const Scaffold(body: FinalIncentiveHistory()),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('Your final commissions'), findsOneWidget);
        await tester.scrollUntilVisible(
          find.text('Synthetic agent'),
          200,
          scrollable: find
              .descendant(
                of: find.byType(ListView).first,
                matching: find.byType(Scrollable),
              )
              .first,
        );
        await tester.pumpAndSettle();
        expect(find.text('Synthetic agent'), findsOneWidget);
        expect(service.reads, 1);
        service.tick();
        await tester.pump();
        expect(find.byType(CircularProgressIndicator), findsNothing);
        expect(find.text('Synthetic agent'), findsOneWidget);
        await tester.pumpAndSettle();
        expect(service.reads, 2);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
      },
    );
  }
}
