import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/main.dart';
import 'package:relay_agent/services.dart';

class ProfileService extends RelayService {
  String? shiftPath, shiftAction;
  final bool ownAgent, onShift;
  ProfileService({
    bool agent = false,
    bool canShift = false,
    this.ownAgent = true,
    this.onShift = false,
  }) {
    user = {
      'id': 'leader-account',
      'name': agent ? 'Own Sales Agent' : 'Branch Leader',
      'role': agent ? 'Field Agent' : 'Team Leader',
      'agent_id': agent ? 'own-agent' : null,
      'permissions': ['read', if (canShift) 'shift.write'],
    };
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          if (options.path.endsWith('/shift')) {
            shiftPath = options.path;
            shiftAction = options.data['action'];
          }
          handler.resolve(
            Response(
              requestOptions: options,
              statusCode: 200,
              data: options.path == '/resources/branches'
                  ? [
                      {'id': 'marina', 'name': 'Marina Branch'},
                    ]
                  : {},
            ),
          );
        },
      ),
    );
  }
  @override
  Future<List<Json>> list(String resource) async => [
    if (user?['agent_id'] != null && ownAgent)
      {
        'id': 'own-agent',
        'name': 'Own Sales Agent',
        'employee_id': 'OWN-1042',
        'branch': 'Marina Branch',
        'on_shift': onShift,
      },
    {
      'id': 'subordinate-agent',
      'name': 'Sales Agent',
      'employee_id': 'SUBORDINATE-1041',
      'branch': 'Marina Branch',
    },
  ];
}

void main() {
  testWidgets(
    'leader profile never borrows an employee ID or shift actions from a subordinate',
    (tester) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [serviceProvider.overrideWith((ref) => ProfileService())],
          child: const MaterialApp(home: Scaffold(body: ProfileScreen())),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Branch Leader'), findsOneWidget);
      expect(find.text('SUBORDINATE-1041'), findsNothing);
      expect(find.text('Marina Branch'), findsOneWidget);
      expect(find.text('Start shift'), findsNothing);
      expect(find.text('End shift'), findsNothing);
      expect(find.byType(FilledButton), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
  for (final onShift in [false, true]) {
    testWidgets(
      'authorized sales agent can ${onShift ? 'end' : 'start'} only their own shift',
      (tester) async {
        final service = ProfileService(
          agent: true,
          canShift: true,
          onShift: onShift,
        );
        await tester.pumpWidget(
          ProviderScope(
            overrides: [serviceProvider.overrideWith((ref) => service)],
            child: const MaterialApp(home: Scaffold(body: ProfileScreen())),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('OWN-1042'), findsOneWidget);
        final action = find.text(onShift ? 'End shift' : 'Start shift');
        await tester.ensureVisible(action);
        await tester.pumpAndSettle();
        await tester.tap(action);
        await tester.pumpAndSettle();
        expect(service.shiftPath, '/agents/own-agent/shift');
        expect(service.shiftAction, onShift ? 'end' : 'start');
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
      },
    );
  }
  for (final hasGrant in [false, true]) {
    testWidgets(
      'shift action is hidden without ${hasGrant ? 'own agent details' : 'effective shift permission'}',
      (tester) async {
        final service = ProfileService(
          agent: true,
          canShift: hasGrant,
          ownAgent: !hasGrant,
        );
        await tester.pumpWidget(
          ProviderScope(
            overrides: [serviceProvider.overrideWith((ref) => service)],
            child: const MaterialApp(home: Scaffold(body: ProfileScreen())),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('Start shift'), findsNothing);
        expect(find.text('End shift'), findsNothing);
        expect(find.byType(FilledButton), findsNothing);
        expect(service.shiftPath, isNull);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
      },
    );
  }
}
