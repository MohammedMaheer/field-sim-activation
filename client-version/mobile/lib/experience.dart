import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

const relayMotion = Duration(milliseconds: 240);

Duration motionDuration(BuildContext context) =>
    MediaQuery.disableAnimationsOf(context) ? Duration.zero : relayMotion;

/// A direct link must have an exit even when it has no navigation history.
class WorkspaceBackButton extends StatelessWidget {
  const WorkspaceBackButton({super.key});
  @override
  Widget build(BuildContext context) => IconButton(
    tooltip: 'Back',
    icon: const Icon(Icons.arrow_back_rounded),
    onPressed: () {
      final router = GoRouter.of(context);
      if (router.canPop()) {
        router.pop();
      } else {
        router.go('/');
      }
    },
  );
}

class RelayPageTransitions extends PageTransitionsBuilder {
  const RelayPageTransitions();
  @override
  Widget buildTransitions<T>(
    PageRoute<T> route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    if (MediaQuery.disableAnimationsOf(context)) return child;
    final curve = animation.drive(CurveTween(curve: Curves.easeOutCubic));
    return FadeTransition(
      opacity: curve,
      child: SlideTransition(
        position: curve.drive(
          Tween(begin: const Offset(.025, 0), end: Offset.zero),
        ),
        child: child,
      ),
    );
  }
}

/// A single, short entrance; never pulses forever while data is loading.
class EnterSurface extends StatelessWidget {
  final Widget child;
  const EnterSurface({super.key, required this.child});
  @override
  Widget build(BuildContext context) => TweenAnimationBuilder<double>(
    tween: Tween(begin: 0, end: 1),
    duration: motionDuration(context),
    curve: Curves.easeOutCubic,
    child: child,
    builder: (context, value, child) => Opacity(
      opacity: value,
      child: Transform.translate(
        offset: Offset(0, 8 * (1 - value)),
        child: child,
      ),
    ),
  );
}
