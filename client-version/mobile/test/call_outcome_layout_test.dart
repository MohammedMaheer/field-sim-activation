import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/call_work.dart';
import 'package:relay_agent/services.dart';

class CallOutcomeService extends RelayService {
  bool rejectSave = false;
  Completer<void>? pendingSave;
  final writes = <Map<String, dynamic>>[];
  CallOutcomeService({String status = 'PENDING'}) {
    ready = true;
    user = {
      'id': 'call-test',
      'role': 'Tele Verification Officer',
      'permissions': ['call.tele.read', 'call.tele.write'],
    };
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          if (options.method == 'POST') {
            writes.add({'path': options.path, 'body': options.data});
            await pendingSave?.future;
            if (rejectSave) {
              handler.reject(
                DioException(
                  requestOptions: options,
                  type: DioExceptionType.badResponse,
                  response: Response(
                    requestOptions: options,
                    statusCode: 409,
                    data: {
                      'detail': 'This call changed. Check before trying again.',
                    },
                  ),
                ),
              );
            } else {
              handler.resolve(
                Response(
                  requestOptions: options,
                  statusCode: 200,
                  data: {'status': 'COMPLETED'},
                ),
              );
            }
            return;
          }
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
                    'msisdn': '0500000094',
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
  for (final postpone in [false, true]) {
    testWidgets(
      '${postpone ? "postponing" : "recording"} retains failed entries and blocks repeat saves',
      (tester) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final service = CallOutcomeService()..rejectSave = true;
        await tester.pumpWidget(
          ProviderScope(
            overrides: [serviceProvider.overrideWith((ref) => service)],
            child: const MaterialApp(home: CallWorkScreen()),
          ),
        );
        await tester.pumpAndSettle();
        final action = postpone ? 'Postpone to next day' : 'Record call';
        await tester.ensureVisible(find.text(action));
        await tester.tap(find.text(action));
        await tester.pumpAndSettle();
        expect(find.text('Phone: 0500000094').last, findsOneWidget);
        if (!postpone) {
          await tester.tap(find.byType(DropdownButtonFormField<String>).last);
          await tester.pumpAndSettle();
          await tester.tap(find.text('No answer').last);
          await tester.pumpAndSettle();
        }
        final field = find.widgetWithText(
          TextFormField,
          postpone ? 'Technical reason' : 'Call remark',
        );
        await tester.enterText(field, 'Customer line temporarily unavailable');
        final save = find.widgetWithText(
          FilledButton,
          postpone ? 'Postpone to next day' : 'Save outcome',
        );
        await tester.ensureVisible(save);
        await tester.tap(save);
        await tester.pumpAndSettle();
        expect(
          find.text('This call changed. Check before trying again.'),
          findsOneWidget,
        );
        expect(
          tester.widget<TextFormField>(field).controller?.text ??
              tester.state<FormFieldState<String>>(field).value,
          'Customer line temporarily unavailable',
        );
        expect(service.writes.length, 1);
        service.rejectSave = false;
        service.pendingSave = Completer<void>();
        await tester.tap(save);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 100));
        expect(service.writes.length, 2);
        expect(
          tester
              .widget<FilledButton>(
                find.widgetWithText(FilledButton, 'Saving…'),
              )
              .onPressed,
          isNull,
        );
        expect(
          tester
              .widget<TextButton>(find.widgetWithText(TextButton, 'Cancel'))
              .onPressed,
          isNull,
        );
        expect(
          tester
              .widget<IconButton>(
                find.byWidgetPredicate(
                  (widget) =>
                      widget is IconButton &&
                      widget.tooltip == 'Close call form',
                ),
              )
              .onPressed,
          isNull,
        );
        service.pendingSave!.complete();
        await tester.pumpAndSettle();
        expect(
          find.text(postpone ? 'Technical reason' : 'Call remark'),
          findsNothing,
        );
        expect(
          service.writes.last['path'],
          '/sales-management/sales/sale-test/calls${postpone ? '/defer-tele' : ''}',
        );
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
      },
    );
  }

  testWidgets('a changed branch cannot submit an open call form', (
    tester,
  ) async {
    final service = CallOutcomeService();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [serviceProvider.overrideWith((ref) => service)],
        child: const MaterialApp(home: CallWorkScreen()),
      ),
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Postpone to next day'));
    await tester.tap(find.text('Postpone to next day'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Technical reason'),
      'Carrier system temporarily unavailable',
    );
    service.selectBranch('marina');
    await tester.pumpAndSettle();
    final save = find.widgetWithText(FilledButton, 'Postpone to next day');
    await tester.ensureVisible(save);
    await tester.tap(save);
    await tester.pumpAndSettle();
    expect(
      find.text(
        'Branch or calling access changed. Close and reopen this call.',
      ),
      findsOneWidget,
    );
    expect(service.writes, isEmpty);
    await tester.pumpWidget(const SizedBox());
  });
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
