import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/field_assets.dart';
import 'package:relay_agent/services.dart';

class StockRequestService extends RelayService {
  Json? submitted;
  StockRequestService() {
    ready = true;
    user = {
      'id': 'agent-test',
      'agent_id': 'agent-test',
      'role': 'Field Agent',
    };
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          if (options.method == 'POST') {
            submitted = Map<String, dynamic>.from(options.data as Map);
          }
          handler.resolve(
            Response(
              requestOptions: options,
              statusCode: 200,
              data: <dynamic>[],
            ),
          );
        },
      ),
    );
  }
}

void main() {
  testWidgets(
    'stock request stays usable on a small phone with keyboard open',
    (tester) async {
      tester.view.physicalSize = const Size(320, 568);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetViewInsets);
      final service = StockRequestService();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [serviceProvider.overrideWith((ref) => service)],
          child: const MaterialApp(home: FieldAssetsScreen()),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Request stock'));
      await tester.pumpAndSettle();
      tester.view.viewInsets = const FakeViewPadding(bottom: 280);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      final reason = find.widgetWithText(TextFormField, 'Reason');
      await tester.ensureVisible(reason);
      await tester.enterText(reason, 'Replacement device needed');
      await tester.ensureVisible(find.text('Submit request'));
      expect(tester.takeException(), isNull);
      await tester.tap(find.text('Submit request'));
      await tester.pumpAndSettle();
      expect(service.submitted, {
        'agent_id': 'agent-test',
        'category': 'GRABBA_DEVICE',
        'quantity': 1,
        'urgency': 'NORMAL',
        'reason': 'Replacement device needed',
      });
      expect(find.text('Stock request sent'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
