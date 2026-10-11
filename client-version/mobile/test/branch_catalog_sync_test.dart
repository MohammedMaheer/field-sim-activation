import 'dart:async';
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
  Completer<List<Json>>? branchResponse;
  CatalogService() {
    user = {'id': 'caller-account', 'role': 'Tele Verification Officer'};
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          expect(options.path, '/resources/branches');
          expect(options.queryParameters['branch_id'], isNull);
          requests++;
          final response = branchResponse == null
              ? branches
              : await branchResponse!.future;
          handler.resolve(
            Response(
              requestOptions: options,
              statusCode: 200,
              data: response.map((row) => Json.from(row)).toList(),
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

Future<void> flushRefresh(WidgetTester tester) async {
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 10));
  }
}

void main() {
  testWidgets(
    'background catalog refresh preserves dropdown height, element and scroll position',
    (tester) async {
      final service = CatalogService();
      final scroll = ScrollController();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [serviceProvider.overrideWith((ref) => service)],
          child: MaterialApp(
            home: Scaffold(
              body: SingleChildScrollView(
                controller: scroll,
                child: const Column(
                  children: [
                    BranchFilter(),
                    SizedBox(height: 1800, child: Text('Workspace content')),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final dropdown = find.byType(DropdownButtonFormField<String>);
      final originalElement = tester.element(dropdown);
      final originalSize = tester.getSize(dropdown);
      scroll.jumpTo(120);
      await tester.pump();
      final originalPosition = tester.getTopLeft(dropdown);
      service.branchResponse = Completer<List<Json>>();
      service.startSync();
      service.finishSync();
      await flushRefresh(tester);
      expect(service.requests, 2);
      expect(dropdown, findsOneWidget);
      expect(tester.element(dropdown), same(originalElement));
      expect(tester.getSize(dropdown), originalSize);
      expect(tester.getTopLeft(dropdown), originalPosition);
      expect(scroll.offset, 120);
      expect(find.byType(LinearProgressIndicator), findsNothing);
      // New choices still arrive after the stable refresh.
      service.branchResponse!.complete([
        ...service.branches,
        {'id': 'harbour', 'name': 'Harbour Branch'},
      ]);
      await tester.pumpAndSettle();
      expect(tester.element(dropdown), same(originalElement));
      expect(scroll.offset, 120);
      scroll.jumpTo(0);
      await tester.pump();
      await tester.tap(dropdown);
      await tester.pumpAndSettle();
      expect(find.text('Harbour Branch'), findsWidgets);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      scroll.dispose();
    },
  );

  testWidgets(
    'account change hides the previous branch catalog while loading',
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
      expect(find.text('Marina Branch'), findsOneWidget);
      service.branchResponse = Completer<List<Json>>();
      service.user = {...service.user!, 'id': 'second-account'};
      service.notifyListeners();
      await tester.pump();
      await tester.pump();
      expect(find.text('Marina Branch'), findsNothing);
      expect(find.byType(LinearProgressIndicator), findsOneWidget);
      service.branchResponse!.complete([
        {'id': 'downtown', 'name': 'Downtown Branch'},
      ]);
      await tester.pumpAndSettle();
      expect(service.branchId, isNull);
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      expect(find.text('Downtown Branch'), findsWidgets);
      expect(find.text('Marina Branch'), findsNothing);
      await tester.pumpWidget(const SizedBox());
    },
  );

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
      await flushRefresh(tester);
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
      await flushRefresh(tester);
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
