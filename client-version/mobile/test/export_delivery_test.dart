import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/exports.dart';
import 'package:relay_agent/reports.dart';
import 'package:relay_agent/services.dart';

void main() {
  test(
    'server file identity is preserved without paths or unsafe extensions',
    () {
      expect(
        exportFileName(
          Headers.fromMap({
            'content-disposition': [
              'attachment; filename="qanawat-sales-Marina-20261011.pdf"',
            ],
          }),
          'qanawat-sales.pdf',
        ),
        'qanawat-sales-Marina-20261011.pdf',
      );
      expect(
        exportFileName(
          Headers.fromMap({
            'content-disposition': [
              "attachment; filename*=UTF-8''qanawat-sales%20report.xlsx",
            ],
          }),
          'qanawat-sales.xlsx',
        ),
        'qanawat-sales report.xlsx',
      );
      expect(
        exportFileName(
          Headers.fromMap({
            'content-disposition': ['attachment; filename="../../sale.pdf"'],
          }),
          'qanawat-sale.pdf',
        ),
        'sale.pdf',
      );
      for (final unsafe in ['.pdf', 'sale.exe', 'sale\r\n.pdf']) {
        expect(
          exportFileName(
            Headers.fromMap({
              'content-disposition': ['attachment; filename="$unsafe"'],
            }),
            'qanawat-sale.pdf',
          ),
          'qanawat-sale.pdf',
        );
      }
    },
  );

  test('empty and HTML exports cannot be shared as receipts or workbooks', () {
    for (final format in ['pdf', 'xlsx', 'csv']) {
      for (final bytes in [
        <int>[],
        utf8.encode('<!doctype html><html>Sign in</html>'),
      ]) {
        expect(
          () => validatedExportBytes(bytes, format),
          throwsFormatException,
        );
      }
    }
    expect(
      () => validatedExportBytes(utf8.encode('This is not a PDF'), 'pdf'),
      throwsFormatException,
    );
  });

  test('download errors retain the authorized API explanation', () {
    final error = DioException(
      requestOptions: RequestOptions(path: '/reports/daily'),
      response: Response(
        requestOptions: RequestOptions(path: '/reports/daily'),
        statusCode: 403,
        data: utf8.encode('{"detail":"Report access has been removed"}'),
      ),
      type: DioExceptionType.badResponse,
    );
    expect(exportError(error), 'Report access has been removed');
  });

  for (final report in ['daily', 'agent', 'team', 'branch', 'inventory']) {
    for (final format in ['csv', 'xlsx', 'pdf']) {
      test(
        '$report $format retains dates and selected branch through delivery',
        () async {
          final service = RelayService();
          addTearDown(service.dispose);
          service.user = {'id': 'export-user'};
          service.selectBranch('marina-branch');
          final bytes = switch (format) {
            'pdf' => utf8.encode('%PDF-1.7\nReport data'),
            'xlsx' => [0x50, 0x4b, 0x03, 0x04, 0, 0],
            _ => utf8.encode('Customer,MSISDN\r\nSample,0500012345\r\n'),
          };
          service.dio.interceptors.add(
            InterceptorsWrapper(
              onRequest: (options, handler) {
                expect(options.path, '/reports/$report');
                expect(options.responseType, ResponseType.bytes);
                expect(options.queryParameters, {
                  'format': format,
                  'start': '2026-10-07',
                  'end': '2026-10-11',
                  'branch_id': 'marina-branch',
                });
                handler.resolve(
                  Response(
                    requestOptions: options,
                    data: bytes,
                    headers: Headers.fromMap({
                      'content-disposition': [
                        'attachment; filename="qanawat-$report-Marina.$format"',
                      ],
                    }),
                  ),
                );
              },
            ),
          );
          final document = await fetchReportExport(
            service,
            report: report,
            format: format,
            from: DateTime(2026, 10, 7),
            to: DateTime(2026, 10, 11),
          );
          expect(document.bytes, bytes);
          expect(document.filename, 'qanawat-$report-Marina.$format');
          final share = document.shareParams();
          expect(share.fileNameOverrides, [document.filename]);
          expect(share.files!.single.mimeType, exportMimeType(format));
          expect(await share.files!.single.readAsBytes(), bytes);
          expect(share.downloadFallbackEnabled, isTrue);
          expect(share.mailToFallbackEnabled, isFalse);
        },
      );
    }
  }
}
