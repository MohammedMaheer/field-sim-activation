import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/call_work.dart';
import 'package:relay_agent/services.dart';

class CallOutcomeService extends RelayService {
  CallOutcomeService({String status = 'PENDING'}) {
    ready = true;
    user = {
      'id': 'call-test',
      'role': 'Tele Verification Officer',
      'permissions': ['call.tele.read', 'call.tele.write'],
    };
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          final data = options.path == '/resources/branches'
              ? [
                  {'id': 'marina', 'name': 'Marina Branch'},
                ]
              : options.path.endsWith('/summary')
              ? {'actionable': 1}
              : <dynamic>[
                  {
                    'id': 'task-test',
                    'sale_id': 'sale-test',
                    'customer_name': 'Avery Stone',
                    'stage': 'TELE_VERIFICATION',
                    'status': status,
                    'plan_name': 'Plan',
                    'request_id': 'Request',
                    'branch': 'Marina',
                    'agent': 'Agent',
                  },
                ];
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
    'call actions require the matching permission and an actionable state',
    () {
      for (final status in ['COMPLETED', 'BLOCKED', 'SKIPPED', 'CANCELLED']) {
        expect(
          canRecordCall(
            {'stage': 'TELE_VERIFICATION', 'status': status},
            {
              'role': 'Tele Verification Officer',
              'permissions': ['call.tele.write'],
            },
          ),
          isFalse,
        );
      }
      expect(
        canRecordCall(
          {'stage': 'WELCOME_CALL', 'status': 'PENDING'},
          {
            'role': 'Tele Verification Officer',
            'permissions': ['call.tele.write'],
          },
        ),
        isFalse,
      );
      expect(
        canRecordCall(
          {'stage': 'TELE_VERIFICATION', 'status': 'FAILED'},
          {
            'role': 'Tele Verification Officer',
            'permissions': ['call.tele.write'],
          },
        ),
        isTrue,
      );
    },
  );
  testWidgets(
    'completed call notification shows its record without an outcome form',
    (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            serviceProvider.overrideWith(
              (ref) => CallOutcomeService(status: 'COMPLETED'),
            ),
          ],
          child: const MaterialApp(
            home: CallWorkScreen(selectedId: 'task-test'),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Avery Stone'), findsOneWidget);
      expect(find.text('completed'), findsOneWidget);
      expect(find.text('Call remark'), findsNothing);
      expect(find.text('Record call'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
  testWidgets(
    'cancelling a call outcome with the keyboard open closes safely',
    (tester) async {
      tester.view.physicalSize = const Size(320, 568);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetViewInsets);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            serviceProvider.overrideWith((ref) => CallOutcomeService()),
          ],
          child: const MaterialApp(home: CallWorkScreen()),
        ),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Record call'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Record call'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Call remark'),
        'Customer reached',
      );
      tester.view.viewInsets = const FakeViewPadding(bottom: 280);
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Cancel'));
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(find.text('Call remark'), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
