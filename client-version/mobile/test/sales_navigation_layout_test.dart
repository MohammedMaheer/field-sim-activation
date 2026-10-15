import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/relay_theme.dart';
import 'package:relay_agent/sales_management.dart';
import 'package:relay_agent/services.dart';

class _SalesLayoutService extends RelayService {
  _SalesLayoutService() {
    ready = true;
    user = {
      'id': 'sales-layout-member',
      'agent_id': 'sales-layout-agent',
      'role': 'Field Agent',
      'permissions': ['read', 'ekyc.write'],
    };
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (request, handler) {
          final dynamic data = request.path == '/notifications'
              ? {'items': [], 'unread': 0, 'categories': []}
              : request.path.contains('/performance')
              ? {'recorded': 0, 'closed': 0, 'remaining': 0}
              : <dynamic>[];
          handler.resolve(
            Response(requestOptions: request, statusCode: 200, data: data),
          );
        },
      ),
    );
  }
}

RenderParagraph _paragraph(WidgetTester tester, String text) =>
    tester.renderObject<RenderParagraph>(
      find.descendant(of: find.text(text), matching: find.byType(RichText)),
    );

void main() {
  setUpAll(() async {
    for (final entry in {
      'DM Sans': 'dmsans.ttf',
      'Manrope': 'manrope.ttf',
    }.entries) {
      await (FontLoader(
        entry.key,
      )..addFont(rootBundle.load('assets/fonts/${entry.value}'))).load();
    }
  });
  for (final size in [300.0, 360.0, 390.0]) {
    for (final scale in [1.0, 1.5]) {
      testWidgets(
        'sales heading and selected Feedback stay complete at $size / $scale',
        (tester) async {
          tester.view.physicalSize = Size(size, 900);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          await tester.pumpWidget(
            ProviderScope(
              overrides: [
                serviceProvider.overrideWith((ref) => _SalesLayoutService()),
              ],
              child: MaterialApp(
                theme: relayTheme(),
                builder: (context, child) => MediaQuery(
                  data: MediaQuery.of(
                    context,
                  ).copyWith(textScaler: TextScaler.linear(scale)),
                  child: child!,
                ),
                home: const Scaffold(body: Text('Home')),
                initialRoute: '/sales',
                routes: {
                  '/sales': (_) => const SalesManagementScreen(initialTab: 1),
                },
              ),
            ),
          );
          await tester.pumpAndSettle();
          final heading = _paragraph(tester, 'Sales management');
          expect(heading.didExceedMaxLines, isFalse);
          for (final word in RegExp(r'\S+').allMatches('Sales management')) {
            final boxes = heading.getBoxesForSelection(
              TextSelection(baseOffset: word.start, extentOffset: word.end),
            );
            expect(
              boxes,
              hasLength(1),
              reason: 'Each heading word must remain intact',
            );
            expect(boxes.single.left, greaterThanOrEqualTo(-.5));
            expect(
              boxes.single.right,
              lessThanOrEqualTo(heading.size.width + .5),
            );
          }
          for (final label in ['Sales', 'Feedback', 'Targets']) {
            final paragraph = _paragraph(tester, label);
            expect(paragraph.didExceedMaxLines, isFalse);
            final boxes = paragraph.getBoxesForSelection(
              TextSelection(baseOffset: 0, extentOffset: label.length),
            );
            expect(
              boxes,
              hasLength(1),
              reason: '$label must not split across lines',
            );
            expect(
              boxes.single.right,
              lessThanOrEqualTo(paragraph.size.width + .5),
            );
            expect(find.text(label).hitTestable(), findsOneWidget);
          }
          expect(find.text('Add feedback').hitTestable(), findsOneWidget);
          await tester.tap(find.text('Targets'));
          await tester.pumpAndSettle();
          expect(find.text('Add feedback'), findsNothing);
          expect(find.text('Product targets'), findsOneWidget);
          await tester.tap(find.text('Feedback'));
          await tester.pumpAndSettle();
          expect(find.text('Add feedback').hitTestable(), findsOneWidget);
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox());
        },
      );
    }
  }
}
