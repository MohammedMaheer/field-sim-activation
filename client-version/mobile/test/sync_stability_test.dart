import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/services.dart';

class ControlledService extends RelayService {
  Completer<Json> response = Completer<Json>();
  int requests = 0;
  ControlledService() {
    user = {'id': 'agent-a'};
  }
  @override
  Future<Json> dashboard() {
    requests++;
    return response.future;
  }

  void startSync() {
    syncing = true;
    notifyListeners();
  }

  void endSync() {
    syncing = false;
    notifyListeners();
  }

  void changeAccount() {
    user = {'id': 'agent-b'};
    notifyListeners();
  }
}

void main() {
  testWidgets(
    'sync retains content; account switch never displays previous data',
    (tester) async {
      final service = ControlledService();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [serviceProvider.overrideWith((ref) => service)],
          child: MaterialApp(
            home: Consumer(
              builder: (context, ref, _) {
                return ref
                    .watch(dashboardProvider)
                    .when(
                      loading: () => const Text('loading'),
                      error: (e, st) => const Text('error'),
                      data: (data) => Text(data['name'] as String),
                    );
              },
            ),
          ),
        ),
      );
      service.response.complete({'name': 'Agent A content'});
      await tester.pump();
      await tester.pump();
      expect(find.text('Agent A content'), findsOneWidget);
      service.response = Completer<Json>();
      service.startSync();
      await tester.pump();
      expect(service.requests, 1);
      expect(find.text('loading'), findsNothing);
      service.endSync();
      await tester.pump();
      expect(service.requests, 2);
      expect(find.text('Agent A content'), findsOneWidget);
      expect(find.text('loading'), findsNothing);
      service.response.complete({'name': 'Updated A content'});
      await tester.pump();
      await tester.pump();
      expect(find.text('Updated A content'), findsOneWidget);
      service.response = Completer<Json>();
      service.changeAccount();
      await tester.pump();
      expect(find.text('Updated A content'), findsNothing);
      expect(find.text('loading'), findsOneWidget);
      service.response.complete({'name': 'Agent B content'});
      await tester.pump();
      await tester.pump();
      expect(find.text('Agent B content'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
