import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/main.dart';
import 'package:relay_agent/relay_theme.dart';
import 'package:relay_agent/services.dart';
import 'package:relay_agent/typography.dart';

const designatedLeader = 'Morgan Shah · Downtown branch sales team';

class AssignmentService extends RelayService {
  AssignmentService() {
    user = {
      'id': 'own-account',
      'agent_id': 'own-agent',
      'name': 'Avery Stone',
      'role': 'Field Agent',
      'branch': 'Downtown Branch',
      'permissions': ['read'],
    };
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) => handler.resolve(
          Response(
            requestOptions: options,
            statusCode: 200,
            data: options.path == '/resources/branches'
                ? []
                : {'items': [], 'unread': 0, 'categories': []},
          ),
        ),
      ),
    );
  }

  final agents = <Json>[
    {
      'id': 'other-agent',
      'user_id': 'other-account',
      'employee_id': 'OTHER-1001',
      'branch': 'Different Branch',
      'leader': 'Different leader',
    },
    {
      'id': 'own-agent',
      'user_id': 'own-account',
      'employee_id': 'OWN-1002',
      'branch': 'Downtown Branch',
      'outlet': 'Downtown Branch',
      'leader': designatedLeader,
      'stock': 8,
      'on_shift': false,
    },
  ];

  @override
  Future<List<Json>> list(String resource) async => agents;

  @override
  Future<Json> dashboard() async => {
    'agents': agents,
    'target': 20,
    'kyc_pending_review': 2,
    'kyc_today': 4,
    'aht': 3,
    'ekyc': 100,
    'recent': [],
  };
}

Widget assignmentSurface(double scale, Widget child) => ProviderScope(
  overrides: [serviceProvider.overrideWith((ref) => AssignmentService())],
  child: MaterialApp(
    theme: relayTheme(),
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(scale), disableAnimations: true),
      child: child!,
    ),
    home: Scaffold(body: child),
  ),
);

void main() {
  for (final width in [320.0, 360.0, 390.0]) {
    for (final scale in [1.0, 1.5, 2.0]) {
      for (final profile in [false, true]) {
        testWidgets(
          '${profile ? 'Profile' : 'Home'} shows the designated leader at $width / $scale',
          (tester) async {
            tester.view.physicalSize = Size(width, 844);
            tester.view.devicePixelRatio = 1;
            addTearDown(tester.view.resetPhysicalSize);
            addTearDown(tester.view.resetDevicePixelRatio);
            await tester.pumpWidget(
              assignmentSurface(
                scale,
                profile ? const ProfileScreen() : const HomeScreen(),
              ),
            );
            await tester.pumpAndSettle();
            final leader = find.text(
              profile ? designatedLeader : 'Team leader · $designatedLeader',
            );
            await tester.scrollUntilVisible(
              leader,
              120,
              scrollable: find.byType(Scrollable).first,
            );
            await tester.ensureVisible(leader);
            await tester.pump();
            expect(leader.hitTestable(), findsOneWidget);
            expect(find.text('Different leader'), findsNothing);
            expect(find.text('OTHER-1001'), findsNothing);
            final bounds = tester.getRect(leader);
            expect(bounds.left, greaterThanOrEqualTo(0));
            expect(bounds.right, lessThanOrEqualTo(width));
            expect(tester.takeException(), isNull);
            await tester.pumpWidget(const SizedBox());
          },
        );
      }
    }
  }

  test('small reading roles have a 13 point floor and semibold labels', () {
    expect(RelayTypography.caption.fontSize, 13);
    expect(RelayTypography.textTheme.bodySmall!.fontSize, 13);
    expect(RelayTypography.label.fontWeight, FontWeight.w600);
    expect(RelayTypography.caption.fontWeight, FontWeight.w600);
    final luminance = RelayTypography.caption.color!.computeLuminance();
    expect((1.0 + .05) / (luminance + .05), greaterThan(7));
  });
}
