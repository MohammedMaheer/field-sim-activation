import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:relay_agent/experience.dart';

void main() {
  testWidgets('back handles a direct link and a pushed screen', (tester) async {
    final router = GoRouter(
      initialLocation: '/details',
      routes: [
        GoRoute(
          path: '/',
          builder: (_, _) => const Scaffold(body: Text('Workspace home')),
        ),
        GoRoute(
          path: '/details',
          builder: (_, _) => Scaffold(
            appBar: AppBar(
              leading: const WorkspaceBackButton(),
              title: const Text('Details'),
            ),
          ),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Back'));
    await tester.pumpAndSettle();
    expect(find.text('Workspace home'), findsOneWidget);
    router.push('/details');
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Back'));
    await tester.pumpAndSettle();
    expect(find.text('Workspace home'), findsOneWidget);
  });

  testWidgets('reduced motion reveals content immediately', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(disableAnimations: true),
          child: EnterSurface(child: Text('Ready')),
        ),
      ),
    );
    expect(tester.widget<Opacity>(find.byType(Opacity)).opacity, 1);
    expect(tester.hasRunningAnimations, isFalse);
  });
}
