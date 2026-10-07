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
    duration: const Duration(milliseconds: 2200),
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
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: _controller,
    builder: (context, _) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          height: 102,
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          decoration: const BoxDecoration(
            borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
            gradient: LinearGradient(
              colors: [Color(0xff25263f), Color(0xff512b60), Color(0xff254857)],
            ),
          ),
          child: Column(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 13,
                  vertical: 8,
                ),
                decoration: BoxDecoration(
                  color: const Color(0xff102b39),
                  border: Border.all(color: const Color(0xff8d829d)),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Row(
                  children: [
                    const Text(
                      'relay.',
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w900,
                        fontSize: 17,
                      ),
                    ),
                    const Spacer(),
                    IconButton(
                      tooltip: 'Replay invoice printing',
                      constraints: const BoxConstraints(
                        minWidth: 32,
                        minHeight: 32,
                      ),
                      padding: EdgeInsets.zero,
                      icon: const Icon(
                        Icons.print_outlined,
                        color: Color(0xff9ff4da),
                        size: 18,
                      ),
                      onPressed: () {
                        if (MediaQuery.disableAnimationsOf(context)) return;
                        _controller.forward(from: 0);
                      },
                    ),
                    Text(
                      _controller.isCompleted ? 'INVOICE READY' : 'PRINTING…',
                      style: const TextStyle(
                        color: Color(0xff9ff4da),
                        fontSize: 10,
                        letterSpacing: 1,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(width: 9),
                    Container(
                      width: 8,
                      height: 8,
                      decoration: const BoxDecoration(
                        color: Color(0xff31d5a3),
                        shape: BoxShape.circle,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                height: 9,
                width: 210,
                margin: const EdgeInsets.only(top: 11),
                decoration: BoxDecoration(
                  color: const Color(0xff101321),
                  border: Border.all(color: const Color(0xff9285a1), width: 2),
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
            ],
          ),
        ),
        AnimatedBuilder(
          animation: _controller,
          child: widget.child,
          builder: (context, child) {
            final progress = Curves.easeInOut.transform(_controller.value);
            return ClipRect(
              key: const ValueKey('invoice-feed'),
              child: Align(
                alignment: Alignment.topCenter,
                heightFactor: progress,
                child: child,
              ),
            );
          },
        ),
      ],
    ),
  );
}
