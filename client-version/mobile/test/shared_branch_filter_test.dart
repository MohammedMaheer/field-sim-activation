import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/services.dart';
import 'package:relay_agent/reports.dart';
import 'package:relay_agent/sales_presentation.dart';

void main() {
  test(
    'branch narrows supported reads, persists across pages and resets for another account',
    () async {
      final service = RelayService()..user = {'id': 'first-account'};
      final requests = <RequestOptions>[];
      service.dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) {
            requests.add(options);
            handler.resolve(
              Response(requestOptions: options, data: [], statusCode: 200),
            );
          },
        ),
      );
      service.selectBranch('marina');
      for (final path in [
        '/resources/inventory',
        '/sales-management/sales',
        '/reports/daily',
      ]) {
        await service.dio.get(path);
        expect(requests.last.queryParameters['branch_id'], 'marina');
      }
      await service.dio.get(
        '/resources/branches',
        options: Options(extra: {'allAuthorizedBranches': true}),
      );
      expect(requests.last.queryParameters['branch_id'], isNull);
      await service.dio.post(
        '/sales-management/sales',
        data: {'agent_id': 'sample'},
      );
      expect(requests.last.queryParameters['branch_id'], isNull);
      service.user = {'id': 'second-account'};
      expect(service.branchId, isNull);
      await service.dio.get('/resources/customers');
      expect(requests.last.queryParameters['branch_id'], isNull);
      service.dispose();
    },
  );
  test('report dates start at Dubai business day including UTC boundary', () {
    expect(
      reportDate(reportToday(DateTime.utc(2026, 10, 8, 20, 5))),
      '2026-10-09',
    );
    expect(
      reportDate(reportToday(DateTime.utc(2026, 10, 8, 19, 59))),
      '2026-10-08',
    );
  });
  test('activation acknowledgement keeps SR separate from backend review', () {
    expect(
      activationLabel({
        'status': 'IN_PROGRESS',
        'external_activation_recorded': true,
      }),
      'Activated · Pending SR verification',
    );
    expect(
      activationLabel({
        'status': 'CLOSED',
        'sr_verification': {'status': 'MISMATCH'},
      }),
      'Activated · SR mismatch',
    );
    expect(
      activationLabel({
        'status': 'CLOSED',
        'sr_verification': {'status': 'MATCHED'},
      }),
      'Fully activated',
    );
    expect(
      activationLabel({
        'status': 'IN_PROGRESS',
        'external_activation_recorded': true,
        'sr_verification': {'status': 'MATCHED'},
      }),
      'Activated · Pending backend review',
    );
    expect(activationLabel({'status': 'CANCELLED'}), 'Cancelled');
    expect(
      activationLabel({'status': 'IN_PROGRESS'}),
      'Pending backend review',
    );
  });
}
