import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/final_incentives.dart';
import 'package:relay_agent/services.dart';
import 'package:relay_agent/relay_theme.dart';

class CommissionService extends RelayService {
  int reads = 0;
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
          if (options.path.startsWith('/incentives/final')) {
            reads++;
            handler.resolve(
              Response(
                requestOptions: options,
                statusCode: 200,
                data: [
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
            handler.resolve(
              Response(requestOptions: options, statusCode: 200, data: []),
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

void main() {
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
        expect(find.text('Final commission amounts'), findsOneWidget);
        expect(find.text('Synthetic agent · AED 125.25'), findsOneWidget);
        expect(service.reads, 1);
        service.tick();
        await tester.pump();
        expect(find.byType(CircularProgressIndicator), findsNothing);
        expect(find.text('Synthetic agent · AED 125.25'), findsOneWidget);
        await tester.pumpAndSettle();
        expect(service.reads, 2);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
      },
    );
  }
}
