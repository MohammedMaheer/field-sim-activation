import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:relay_agent/notifications.dart';
import 'package:relay_agent/relay_theme.dart';
import 'package:relay_agent/services.dart';

const noticeTitle = 'Your transaction has been confirmed by the backend team';
const noticeMessage =
    'REQ-20261012-000123 for the customer with a long subscriber package is '
    'confirmed. The original sales agent and team leader assignment is retained.';

class InboxService extends RelayService {
  final marks = <Json>[];
  final rows = <Json>[
    {
      'id': 'sale-1',
      'category': 'Transactions',
      'title': noticeTitle,
      'message': noticeMessage,
      'mobile_path': '/transaction/sale-1',
      'created_at': '2026-10-12T08:30:00',
      'read': false,
      'attention': true,
    },
    {
      'id': 'support-1',
      'category': 'Support',
      'title': 'Support reply received',
      'message': 'Your branch supply request has an update.',
      'mobile_path': '/support',
      'created_at': '2026-10-12T08:31:00',
      'read': false,
    },
    {
      'id': 'hidden-call',
      'category': 'Transactions',
      'title': 'Restricted call queue',
      'message': 'This route is not permitted for this sales agent.',
      'mobile_path': '/call-work',
      'created_at': '2026-10-12T08:32:00',
      'read': false,
    },
  ];
  InboxService() {
    ready = true;
    user = {
      'id': 'inbox-agent',
      'role': 'Field Agent',
      'permissions': ['read'],
    };
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (request, handler) {
          if (request.path == '/notifications/read') {
            final action = Json.from(request.data);
            marks.add(action);
            for (final row in rows) {
              if ((action['ids'] as List).contains(row['id'])) {
                row['read'] = action['read'];
              }
            }
          }
          handler.resolve(
            Response(
              requestOptions: request,
              statusCode: 200,
              data: request.path == '/notifications'
                  ? {
                      'items': rows,
                      'unread': rows.where((row) => row['read'] != true).length,
                      'categories': ['Transactions', 'Support'],
                    }
                  : {},
            ),
          );
        },
      ),
    );
  }
}

Future<void> frames(WidgetTester tester) async {
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

void main() {
  setUpAll(() async {
    for (final entry in {
      'DM Sans': 'assets/fonts/dmsans.ttf',
      'Manrope': 'assets/fonts/manrope.ttf',
    }.entries) {
      await (FontLoader(
        entry.key,
      )..addFont(rootBundle.load(entry.value))).load();
    }
  });
  for (final width in [300.0, 390.0]) {
    for (final scale in [1.0, 2.0]) {
      testWidgets(
        'notification filters, complete text and read actions at $width/$scale',
        (tester) async {
          tester.view.physicalSize = Size(width, 844);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          final service = InboxService();
          final router = GoRouter(
            initialLocation: '/notifications',
            routes: [
              GoRoute(
                path: '/notifications',
                builder: (_, _) => const NotificationsScreen(),
              ),
              GoRoute(
                path: '/transaction/:id',
                builder: (_, state) => Scaffold(
                  body: Text('Opened ${state.pathParameters['id']}'),
                ),
              ),
              GoRoute(
                path: '/support',
                builder: (_, _) => const Scaffold(body: Text('Opened support')),
              ),
            ],
          );
          addTearDown(router.dispose);
          await tester.pumpWidget(
            ProviderScope(
              overrides: [serviceProvider.overrideWith((ref) => service)],
              child: MaterialApp.router(
                theme: relayTheme(),
                routerConfig: router,
                builder: (context, child) => MediaQuery(
                  data: MediaQuery.of(
                    context,
                  ).copyWith(textScaler: TextScaler.linear(scale)),
                  child: child!,
                ),
              ),
            ),
          );
          await frames(tester);
          expect(find.text('Restricted call queue'), findsNothing);
          expect(find.text('Transactions'), findsOneWidget);
          await tester.scrollUntilVisible(
            find.text(noticeTitle),
            160,
            scrollable: find.byType(Scrollable).first,
          );
          for (final text in [noticeTitle, noticeMessage]) {
            final label = find.text(text);
            final paragraph = tester.renderObject<RenderParagraph>(
              find.descendant(of: label, matching: find.byType(RichText)),
            );
            expect(paragraph.didExceedMaxLines, isFalse);
            final rect = tester.getRect(label);
            expect(rect.left, greaterThanOrEqualTo(15));
            expect(rect.right, lessThanOrEqualTo(width - 15));
          }
          expect(
            tester.getRect(find.text(noticeTitle)).bottom,
            lessThan(tester.getRect(find.text(noticeMessage)).top),
          );
          await tester.ensureVisible(find.text(noticeTitle));
          await tester.tap(find.text(noticeTitle));
          await frames(tester);
          expect(find.text('Opened sale-1'), findsOneWidget);
          expect(service.marks.single, {
            'ids': ['sale-1'],
            'read': true,
          });
          router.pop();
          await frames(tester);
          await tester.scrollUntilVisible(
            find.widgetWithText(ChoiceChip, 'Support'),
            -160,
            scrollable: find.byType(Scrollable).first,
          );
          await Scrollable.ensureVisible(
            tester.element(find.widgetWithText(ChoiceChip, 'Support')),
            alignment: .5,
          );
          await frames(tester);
          await tester.tap(find.widgetWithText(ChoiceChip, 'Support'));
          await frames(tester);
          expect(find.text(noticeTitle), findsNothing);
          await tester.ensureVisible(find.text('Read shown'));
          await tester.tap(find.text('Read shown'));
          await frames(tester);
          expect(service.marks.last, {
            'ids': ['support-1'],
            'read': true,
          });
          expect(
            service.marks.expand((row) => row['ids'] as List),
            isNot(contains('hidden-call')),
          );
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox());
        },
      );
    }
  }
}
