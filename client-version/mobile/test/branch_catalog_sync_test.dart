import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/branch_filter.dart';
import 'package:relay_agent/services.dart';

class CatalogService extends RelayService {
  List<Json> branches = [
    {'id': 'marina', 'name': 'Marina Branch'},
  ];
  int requests = 0;
  CatalogService() {
    user = {'id': 'caller-account', 'role': 'Tele Verification Officer'};
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          expect(options.path, '/resources/branches');
          expect(options.queryParameters['branch_id'], isNull);
          requests++;
          handler.resolve(
            Response(
              requestOptions: options,
              statusCode: 200,
              data: branches.map((row) => Json.from(row)).toList(),
            ),
          );
        },
      ),
    );
  }
  void startSync() {
    syncing = true;
    notifyListeners();
  }

  void finishSync() {
    syncing = false;
    syncRevision++;
    notifyListeners();
  }
}

void main() {
  testWidgets(
    'sync refreshes authorized branch choices and clears a removed selection without sign-out',
    (tester) async {
      final service = CatalogService();
      service.selectBranch('marina');
      await tester.pumpWidget(
        ProviderScope(
          overrides: [serviceProvider.overrideWith((ref) => service)],
          child: const MaterialApp(home: Scaffold(body: BranchFilter())),
        ),
      );
      await tester.pumpAndSettle();
      expect(service.requests, 1);
      expect(service.branchId, 'marina');
      expect(find.text('Marina Branch'), findsWidgets);
      service.startSync();
      await tester.pumpAndSettle();
      expect(service.requests, 1);
      expect(service.branchId, 'marina');
      service.branches = [
        {'id': 'downtown', 'name': 'Downtown Branch'},
      ];
      service.finishSync();
      await tester.pumpAndSettle();
      expect(service.requests, 2);
      expect(service.branchId, isNull);
      final dropdown = find.byType(DropdownButtonFormField<String>);
      expect(
        tester.widget<DropdownButtonFormField<String>>(dropdown).initialValue,
        '',
      );
      await tester.tap(dropdown);
      await tester.pumpAndSettle();
      expect(find.text('Downtown Branch'), findsWidgets);
      expect(find.text('Marina Branch'), findsNothing);
      await tester.tap(find.text('Downtown Branch').last);
      await tester.pumpAndSettle();
      expect(service.branchId, 'downtown');
      service.startSync();
      service.branches = [
        {'id': 'downtown', 'name': 'Downtown Branch'},
        {'id': 'harbour', 'name': 'Harbour Branch'},
      ];
      service.finishSync();
      await tester.pumpAndSettle();
      expect(service.requests, 3);
      expect(service.branchId, 'downtown');
      await tester.tap(dropdown);
      await tester.pumpAndSettle();
      expect(find.text('Harbour Branch'), findsWidgets);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
