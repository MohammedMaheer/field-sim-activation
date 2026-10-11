import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/exports.dart';
import 'package:relay_agent/relay_theme.dart';
import 'package:relay_agent/services.dart';

void main() {
  testWidgets(
    'export format menu stays compact and readable on a narrow phone',
    (tester) async {
      tester.view.physicalSize = const Size(300, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final service = RelayService();
      service.user = {
        'id': 'export-account',
        'permissions': ['read', 'report.read'],
      };
      await tester.pumpWidget(
        ProviderScope(
          overrides: [serviceProvider.overrideWith((_) => service)],
          child: MaterialApp(
            theme: relayTheme(),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: const TextScaler.linear(2)),
              child: child!,
            ),
            home: const Scaffold(
              body: Padding(
                padding: EdgeInsets.all(16),
                child: ExportActions(
                  endpoint: '/commissions/export',
                  filenameStem: 'qanawat-calculated-commissions',
                  label: 'Export calculated incentives',
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Export calculated incentives'));
      await tester.pumpAndSettle();
      expect(find.text('Excel'), findsOneWidget);
      expect(find.text('PDF'), findsOneWidget);
      expect(find.text('CSV'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'failed download retries the same filtered export and shows permission changes',
    (tester) async {
      final service = RelayService();
      service.user = {
        'id': 'export-account',
        'permissions': ['read', 'report.read'],
      };
      service.selectBranch('marina');
      var requests = 0;
      service.dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) {
            requests++;
            expect(options.path, '/sales-management/export');
            expect(options.queryParameters, {
              'period': '2026-10',
              'branch_id': 'marina',
              'format': 'pdf',
            });
            if (requests == 1) {
              handler.resolve(
                Response(
                  requestOptions: options,
                  statusCode: 200,
                  data: <int>[],
                ),
              );
            } else {
              handler.reject(
                DioException(
                  requestOptions: options,
                  type: DioExceptionType.badResponse,
                  response: Response(
                    requestOptions: options,
                    statusCode: 403,
                    data: utf8.encode(
                      '{"detail":"Report access has been removed"}',
                    ),
                  ),
                ),
              );
            }
          },
        ),
      );
      await tester.pumpWidget(
        ProviderScope(
          overrides: [serviceProvider.overrideWith((_) => service)],
          child: const MaterialApp(
            home: Scaffold(
              body: ExportActions(
                endpoint: '/sales-management/export',
                filenameStem: 'qanawat-sales-2026-10',
                label: 'Export sales',
                query: {'period': '2026-10'},
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Export sales'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('PDF'));
      await tester.pumpAndSettle();
      expect(
        find.text('The export was empty. Please try again.'),
        findsOneWidget,
      );
      await tester.tap(find.text('Retry export'));
      await tester.pumpAndSettle();
      expect(requests, 2);
      expect(find.text('Report access has been removed'), findsOneWidget);
      service.user = {
        'id': 'export-account',
        'permissions': ['read'],
      };
      service.selectBranch('marina');
      await tester.pumpAndSettle();
      expect(find.text('Export sales'), findsNothing);
      expect(find.text('Retry export'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  for (final endpoint in [
    '/commissions/export',
    '/incentives/export',
    '/sales-management/export',
    '/reports/inventory',
    '/field-assets/report/export',
  ]) {
    test(
      '$endpoint export shares the account branch and explicit report settings',
      () async {
        final service = RelayService();
        addTearDown(service.dispose);
        service.user = {'id': 'export-account'};
        service.selectBranch('marina');
        service.dio.interceptors.add(
          InterceptorsWrapper(
            onRequest: (options, handler) {
              expect(options.path, endpoint);
              expect(options.queryParameters, {
                'period': '2026-10',
                'branch_id': 'marina',
                'format': 'csv',
              });
              handler.resolve(
                Response(
                  requestOptions: options,
                  data: utf8.encode('Reference,Status\r\nSale,Closed\r\n'),
                ),
              );
            },
          ),
        );
        final document = await fetchExportDocument(
          service,
          endpoint: endpoint,
          format: 'csv',
          filenameStem: 'qanawat-filtered-records',
          query: {'period': '2026-10'},
        );
        expect(document.filename, 'qanawat-filtered-records.csv');
        expect(document.mimeType, 'text/csv');
      },
    );
  }
}
