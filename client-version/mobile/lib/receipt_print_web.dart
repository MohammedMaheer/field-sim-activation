import 'dart:async';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';
import 'dart:typed_data';

@JS('document.createElement')
external JSObject _createElement(JSString tag);
@JS('document.body.appendChild')
external void _append(JSObject element);

/// Prints paper HTML directly, without printing the Flutter canvas or loading a CDN.
Future<void> printReceiptBytes(
  Uint8List bytes,
  String document,
  String filename,
) {
  final ready = Completer<void>();
  final frame = _createElement('iframe'.toJS);
  void remove() => frame.callMethod<JSAny?>('remove'.toJS);
  frame.callMethod<JSAny?>(
    'setAttribute'.toJS,
    'title'.toJS,
    'Qanawat receipt print document'.toJS,
  );
  frame.callMethod<JSAny?>(
    'setAttribute'.toJS,
    'aria-hidden'.toJS,
    'true'.toJS,
  );
  frame.callMethod<JSAny?>(
    'setAttribute'.toJS,
    'style'.toJS,
    'position:fixed;left:-10000px;top:0;width:800px;height:1000px;border:0;'
        .toJS,
  );
  frame.setProperty(
    'onload'.toJS,
    (() {
      try {
        final target = frame.getProperty<JSObject?>('contentWindow'.toJS);
        if (target == null) {
          throw StateError('Could not open receipt printing.');
        }
        target.setProperty('onafterprint'.toJS, remove.toJS);
        target.callMethod<JSAny?>('focus'.toJS);
        target.callMethod<JSAny?>('print'.toJS);
        Timer(const Duration(minutes: 3), remove);
        if (!ready.isCompleted) ready.complete();
      } catch (error, stack) {
        remove();
        if (!ready.isCompleted) ready.completeError(error, stack);
      }
    }).toJS,
  );
  frame.setProperty(
    'onerror'.toJS,
    (() {
      remove();
      if (!ready.isCompleted) {
        ready.completeError(
          StateError(
            'Could not prepare receipt printing. Download the PDF instead.',
          ),
        );
      }
    }).toJS,
  );
  frame.setProperty('srcdoc'.toJS, document.toJS);
  _append(frame);
  return ready.future;
}
