import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/branding.dart';

void main() {
  for (final width in [112.0, 146.0, 230.0]) {
    testWidgets('supplied company logo stays visible at $width pixels', (
      tester,
    ) async {
      final semantics = tester.ensureSemantics();
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Center(child: QanawatBrand(width: width)),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final image = tester.widget<Image>(find.byType(Image));
      expect((image.image as AssetImage).assetName, qanawatLogoAsset);
      expect(image.fit, BoxFit.contain);
      expect(find.bySemanticsLabel(companyName), findsOneWidget);
      expect(tester.takeException(), isNull);
      semantics.dispose();
    });
  }
  testWidgets('dark receipt header gives original artwork a readable surface', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: QanawatBrand(width: 120, darkSurface: true)),
      ),
    );
    await tester.pumpAndSettle();
    final surfaces = tester.widgetList<DecoratedBox>(find.byType(DecoratedBox));
    expect(
      surfaces.any(
        (box) => (box.decoration as BoxDecoration).color == Colors.white,
      ),
      isTrue,
    );
    expect(tester.takeException(), isNull);
  });
}
