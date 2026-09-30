import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/sales_management.dart';

void main() {
  test('targets and performance stay in the API reporting month at midnight', () {
    expect(salesReportingPeriod(DateTime.parse('2026-10-01T00:15:00+05:30')), '2026-09');
    expect(salesReportingPeriod(DateTime.parse('2026-09-30T20:15:00-04:00')), '2026-10');
    expect(salesReportingPeriod(DateTime.utc(2027, 1, 1)), '2027-01');
  });
}
