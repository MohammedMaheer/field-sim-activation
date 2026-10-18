import 'package:dio/dio.dart';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/field_assets.dart';
import 'package:relay_agent/services.dart';

class StockRequestService extends RelayService {
  Json? submitted;
  bool rejectRequest = false;
  Completer<void>? pendingRequest;
  int posts = 0;
  StockRequestService() {
    ready = true;
    user = {
      'id': 'agent-test',
      'agent_id': 'agent-test',
      'role': 'Field Agent',
      'permissions': ['read', 'inventory.self'],
    };
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          if (options.method == 'POST') {
            posts++;
            submitted = Map<String, dynamic>.from(options.data as Map);
            if (pendingRequest != null) await pendingRequest!.future;
            if (rejectRequest) {
              handler.reject(
                DioException(
                  requestOptions: options,
                  response: Response(
                    requestOptions: options,
                    statusCode: 409,
                    data: {
                      'detail':
                          'Branch stock changed. Check the requested quantity.',
                    },
                  ),
                ),
              );
              return;
            }
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
    'a failed request keeps all fields and a pending retry cannot submit twice',
    (tester) async {
      final service = StockRequestService()..rejectRequest = true;
      await tester.pumpWidget(
        ProviderScope(
          overrides: [serviceProvider.overrideWith((ref) => service)],
          child: const MaterialApp(home: FieldAssetsScreen()),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Request stock'));
      await tester.pumpAndSettle();
      final quantity = find.widgetWithText(TextFormField, 'Quantity');
      final reason = find.widgetWithText(TextFormField, 'Reason');
      await tester.enterText(quantity, '3');
      await tester.ensureVisible(reason);
      await tester.enterText(reason, 'Replacement uniform needed');
      await tester.ensureVisible(find.text('Submit request'));
      await tester.tap(find.text('Submit request'));
      await tester.pumpAndSettle();
      expect(
        find.text('Branch stock changed. Check the requested quantity.'),
        findsOneWidget,
      );
      expect(find.text('Replacement uniform needed'), findsOneWidget);
      expect(find.text('Submit request'), findsOneWidget);
      service.rejectRequest = false;
      service.pendingRequest = Completer<void>();
      await tester.ensureVisible(find.text('Submit request'));
      await tester.tap(find.text('Submit request'));
      for (var attempt = 0; attempt < 10 && service.posts < 2; attempt++) {
        await tester.pump(const Duration(milliseconds: 50));
      }
      expect(service.posts, 2);
      expect(find.text('Sending…'), findsOneWidget);
      final submit = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Sending…'),
      );
      expect(submit.onPressed, isNull);
      expect(tester.widget<TextFormField>(reason).enabled, isFalse);
      service.pendingRequest!.complete();
      await tester.pumpAndSettle();
      expect(service.posts, 2);
      expect(service.submitted!['quantity'], 3);
      expect(service.submitted!['reason'], 'Replacement uniform needed');
      expect(find.text('Stock request sent'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
  testWidgets('stock request control follows effective permission revocation', (
    tester,
  ) async {
    final service = StockRequestService();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [serviceProvider.overrideWith((ref) => service)],
        child: const MaterialApp(home: FieldAssetsScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Request stock'), findsOneWidget);
    service.user = {
      ...service.user!,
      'permissions': ['read'],
    };
    service.notifyListeners();
    await tester.pumpAndSettle();
    expect(find.text('Request stock'), findsNothing);
    expect(service.submitted, isNull);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
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
