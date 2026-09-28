import 'dart:convert';
import 'package:flutter/material.dart';
import 'experience.dart';

class ScanSurface extends StatefulWidget {
  final String? image;
  final bool reading, illustration;
  final String document;
  const ScanSurface({
    super.key,
    this.image,
    this.reading = false,
    this.illustration = false,
    this.document = 'Emirates ID',
  });
  @override
  State<ScanSurface> createState() => _ScanSurfaceState();
}

class _ScanSurfaceState extends State<ScanSurface>
    with SingleTickerProviderStateMixin {
  bool expanded = false;
  late final AnimationController beam;
  @override
  void initState() {
    super.initState();
    beam = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1700),
    );
    if (widget.image == null || widget.reading) beam.repeat(reverse: true);
  }
  @override
  void didUpdateWidget(covariant ScanSurface oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.image != widget.image) expanded = false;
    if (widget.image != null && !widget.reading) {
      beam.stop();
    } else if (!beam.isAnimating) {
      beam.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    beam.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final complete = widget.image != null && !widget.reading;
    if (complete && !expanded) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Material(
          color: const Color(0xffe5f8f2),
          borderRadius: BorderRadius.circular(14),
          child: InkWell(
            borderRadius: BorderRadius.circular(14),
            onTap: () => setState(() => expanded = true),
            child: Container(
              height: 62,
              padding: const EdgeInsets.symmetric(horizontal: 14),
              decoration: BoxDecoration(
                border: Border.all(color: const Color(0xff69d7b4)),
                borderRadius: BorderRadius.circular(14),
              ),
              child: const Row(
                children: [
                  Icon(Icons.check_circle, color: Color(0xff008f69)),
                  SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Document captured',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                  Text(
                    'View',
                    style: TextStyle(
                      color: Color(0xff006b80),
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  Icon(Icons.chevron_right, color: Color(0xff006b80)),
                ],
              ),
            ),
          ),
        ),
      );
    }
    return Container(
      height: complete ? 220 : 142,
      margin: const EdgeInsets.only(bottom: 10),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xff112a49), Color(0xff172139)],
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: complete ? const Color(0xff13b998) : const Color(0xff2aa6ef),
          width: 2,
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x202e80cf),
            blurRadius: 18,
            offset: Offset(0, 6),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned.fill(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(18, 12, 18, 36),
              child: widget.image != null && !widget.illustration
                  ? ClipRRect(
                      borderRadius: BorderRadius.circular(12),
                      child: Image.memory(
                        base64Decode(widget.image!),
                        fit: BoxFit.contain,
                      ),
                    )
                  : Container(
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [Color(0xff234968), Color(0xff24423f)],
                        ),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xff539bb4)),
                      ),
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            widget.document.toUpperCase(),
                            style: const TextStyle(
                              color: Color(0xff61d3ff),
                              fontSize: 11,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 1.5,
                            ),
                          ),
                          const Spacer(),
                          const Row(
                            children: [
                              Icon(
                                Icons.badge_outlined,
                                color: Color(0xffffd97a),
                                size: 44,
                              ),
                              SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      'Identity document',
                                      style: TextStyle(
                                        color: Colors.white,
                                        fontSize: 16,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                    SizedBox(height: 6),
                                    Text(
                                      'Ready to capture',
                                      style: TextStyle(
                                        color: Color(0xff9ce8e4),
                                        fontSize: 12,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                          const Spacer(),
                        ],
                      ),
                    ),
            ),
          ),
          if (!complete)
            Positioned.fill(
              child: IgnorePointer(
                child: AnimatedBuilder(
                  animation: beam,
                  builder: (_, child) => Align(
                    alignment: Alignment(
                      0,
                      MediaQuery.disableAnimationsOf(context)
                          ? 0
                          : beam.value * 1.5 - .75,
                    ),
                    child: Container(
                      height: 4,
                      margin: const EdgeInsets.symmetric(horizontal: 8),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(4),
                        gradient: const LinearGradient(
                          colors: [
                            Color(0x0040caff),
                            Color(0xffa5f3ff),
                            Color(0xff40caff),
                            Color(0x0040caff),
                          ],
                        ),
                        boxShadow: const [
                          BoxShadow(
                            color: Color(0xff40caff),
                            blurRadius: 20,
                            spreadRadius: 4,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          Positioned(
            left: 18,
            right: 18,
            bottom: 12,
            child: AnimatedSwitcher(
              duration: motionDuration(context),
              child: Row(
                key: ValueKey(complete),
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    complete ? Icons.check_circle : Icons.document_scanner,
                    size: 17,
                    color: complete
                        ? const Color(0xff53e5b8)
                        : const Color(0xff78daff),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    complete
                        ? 'Document captured'
                        : widget.reading
                        ? 'Reading document…'
                        : 'Position document',
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (complete)
            Positioned(
              top: 4,
              right: 4,
              child: IconButton(
                tooltip: 'Collapse document preview',
                onPressed: () => setState(() => expanded = false),
                icon: const Icon(Icons.close, color: Colors.white),
              ),
            ),
        ],
      ),
    );
  }
}
