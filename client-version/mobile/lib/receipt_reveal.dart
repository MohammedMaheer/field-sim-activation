import 'package:flutter/material.dart';

/// A single paper-feed reveal; refreshing the record never restarts it.
class ReceiptReveal extends StatefulWidget {
  const ReceiptReveal({super.key, required this.child});
  final Widget child;
  @override
  State<ReceiptReveal> createState() => _ReceiptRevealState();
}

class _ReceiptRevealState extends State<ReceiptReveal>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 700),
  );
  bool _started = false;
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_started) {
      _started = true;
      if (MediaQuery.disableAnimationsOf(context)) {
        _controller.value = 1;
      } else {
        _controller.forward();
      }
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Container(
        height: 14,
        margin: const EdgeInsets.symmetric(horizontal: 12),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(8),
          gradient: const LinearGradient(
            colors: [Color(0xff703bd0), Color(0xffbd3588), Color(0xff00ac8a)],
          ),
        ),
      ),
      AnimatedBuilder(
        animation: _controller,
        child: widget.child,
        builder: (context, child) {
          final progress = Curves.easeOutCubic.transform(_controller.value);
          return ClipRect(
            child: Align(
              alignment: Alignment.topCenter,
              heightFactor: .12 + .88 * progress,
              child: Opacity(
                opacity: .25 + .75 * progress,
                child: Transform.translate(
                  offset: Offset(0, -14 * (1 - progress)),
                  child: child,
                ),
              ),
            ),
          );
        },
      ),
    ],
  );
}
