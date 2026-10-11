import 'dart:typed_data';
import 'package:printing/printing.dart';

Future<void> printReceiptBytes(
  Uint8List bytes,
  String document,
  String filename,
) async {
  await Printing.layoutPdf(
    name: filename,
    onLayout: (_) async => bytes,
    dynamicLayout: false,
  );
}
