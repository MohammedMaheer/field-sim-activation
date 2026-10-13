import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';

import 'location_tracking.dart';
import 'role_access.dart';
import 'services.dart';
import 'experience.dart';

class WorkLocationButton extends ConsumerWidget {
  const WorkLocationButton({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!canVisitMobilePage(
      '/work-location',
      ref.watch(serviceProvider).user,
    )) {
      return const SizedBox.shrink();
    }
    return IconButton(
      tooltip: 'Work location',
      onPressed: () => context.push('/work-location'),
      icon: const Icon(Icons.my_location_outlined),
    );
  }
}

/// One stable-height indicator above every route during an active work session.
/// Polling changes its text without rebuilding or shifting the current page.
class WorkLocationBanner extends ConsumerWidget {
  const WorkLocationBanner({
    super.key,
    required this.child,
    required this.onOpen,
  });
  final Widget child;
  final VoidCallback onOpen;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(serviceProvider).workLocation;
    return ListenableBuilder(
      listenable: controller,
      child: child,
      builder: (context, content) => Column(
        children: [
          if (controller.active && controller.ownDevice)
            SafeArea(
              bottom: false,
              child: Material(
                color: const Color(0xFFE2F5F0),
                child: InkWell(
                  onTap: onOpen,
                  child: SizedBox(
                    height: 38,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 14),
                      child: Row(
                        children: [
                          const Icon(Icons.location_on, size: 17),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              controller.label,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontSize: 13),
                            ),
                          ),
                          const Text(
                            'Work location',
                            style: TextStyle(fontSize: 13),
                          ),
                          const Icon(Icons.chevron_right, size: 18),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          Expanded(
            child: MediaQuery.removePadding(
              context: context,
              removeTop: controller.active && controller.ownDevice,
              child: content!,
            ),
          ),
        ],
      ),
    );
  }
}

class WorkLocationScreen extends ConsumerStatefulWidget {
  const WorkLocationScreen({super.key});
  @override
  ConsumerState<WorkLocationScreen> createState() => _WorkLocationScreenState();
}

class _WorkLocationScreenState extends ConsumerState<WorkLocationScreen> {
  bool loading = true;
  bool actionBusy = false;
  late final WorkLocationController controller;

  @override
  void initState() {
    super.initState();
    controller = ref.read(serviceProvider).workLocation;
    controller.bindAccount(ref.read(serviceProvider).user);
    unawaited(
      controller.load().whenComplete(() {
        if (mounted) setState(() => loading = false);
      }),
    );
  }

  Future<void> act(Future<void> Function() callback) async {
    if (actionBusy) return;
    setState(() => actionBusy = true);
    final wasActive = controller.active;
    try {
      await callback();
      if (wasActive != controller.active) {
        ref.invalidate(resourceProvider('agents'));
        ref.invalidate(dashboardProvider);
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(workLocationError(error))));
      }
    } finally {
      if (mounted) setState(() => actionBusy = false);
    }
  }

  String coordinate(dynamic value) =>
      value is num ? value.toStringAsFixed(5) : 'Not recorded';
  String metres(dynamic value) =>
      value is num ? '${value.round()} m' : 'Not recorded';
  String timestamp(dynamic value) {
    final parsed = DateTime.tryParse('$value')?.toLocal();
    if (parsed == null) return 'Not recorded';
    return '${parsed.day.toString().padLeft(2, '0')}/${parsed.month.toString().padLeft(2, '0')} '
        '${parsed.hour.toString().padLeft(2, '0')}:${parsed.minute.toString().padLeft(2, '0')}:${parsed.second.toString().padLeft(2, '0')}';
  }

  Widget detail(String label, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 7),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Text(label, style: const TextStyle(color: Color(0xFF526079))),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            value,
            textAlign: TextAlign.end,
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
        ),
      ],
    ),
  );

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(serviceProvider).user;
    if (!canVisitMobilePage('/work-location', user)) {
      return const Scaffold(
        body: Center(child: Text('Work location access is unavailable.')),
      );
    }
    return Scaffold(
      appBar: AppBar(
        leading: const WorkspaceBackButton(),
        title: const Text('Work location'),
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : ListenableBuilder(
              listenable: controller,
              builder: (context, _) {
                final boundary = controller.boundary;
                final latest = controller.latest;
                final state = '${latest?['state'] ?? 'NOT_RECORDED'}';
                final fresh = latest?['fresh'] == true;
                final good = fresh && state == 'INSIDE';
                return RefreshIndicator(
                  onRefresh: controller.load,
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                    children: [
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Icon(
                                    Icons.my_location,
                                    color: good
                                        ? const Color(0xFF07816E)
                                        : const Color(0xFF842454),
                                  ),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Text(
                                      controller.active
                                          ? 'Work session active'
                                          : 'Work session not started',
                                      style: const TextStyle(
                                        fontSize: 16,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 8),
                              Text(
                                controller.active && !controller.ownDevice
                                    ? 'This session was started on another device. This device is not sharing location. End the existing session before starting here.'
                                    : controller.active
                                    ? 'Location is shared while Qanawat is open. Updates pause when the app or browser tab is hidden.'
                                    : 'Start a work session to share your device location with authorized management.',
                              ),
                              const SizedBox(height: 12),
                              SizedBox(
                                width: double.infinity,
                                child: FilledButton.icon(
                                  onPressed: actionBusy || controller.busy
                                      ? null
                                      : () => act(
                                          controller.active
                                              ? controller.end
                                              : controller.start,
                                        ),
                                  icon: Icon(
                                    controller.active
                                        ? Icons.stop_circle_outlined
                                        : Icons.play_circle_outline,
                                  ),
                                  label: Text(
                                    actionBusy || controller.busy
                                        ? 'Checking location…'
                                        : controller.active
                                        ? controller.ownDevice
                                              ? 'End work session'
                                              : 'End other device session'
                                        : 'Start work session',
                                  ),
                                ),
                              ),
                              if (controller.active && controller.ownDevice)
                                SizedBox(
                                  width: double.infinity,
                                  child: OutlinedButton.icon(
                                    onPressed: actionBusy
                                        ? null
                                        : () => act(
                                            () => controller.refreshPosition(),
                                          ),
                                    icon: const Icon(Icons.refresh),
                                    label: const Text(
                                      'Refresh device location',
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 10),
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'Assigned boundary',
                                style: TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              const SizedBox(height: 6),
                              detail(
                                'Worksite',
                                '${boundary?['name'] ?? 'Not assigned'}',
                              ),
                              detail('Radius', metres(boundary?['radius_m'])),
                              if (boundary != null)
                                detail(
                                  'Centre',
                                  '${coordinate(boundary['latitude'])}, ${coordinate(boundary['longitude'])}',
                                ),
                              const Divider(height: 18),
                              Text(
                                controller.enabled
                                    ? 'A fresh, accurate location inside this boundary is required to start work or capture a sale.'
                                    : 'Boundary enforcement is not enabled. Management must configure and enable it before work or sales are restricted.',
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 10),
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'Last synchronized location',
                                style: TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              const SizedBox(height: 6),
                              detail(
                                'Boundary status',
                                latest == null
                                    ? 'Not recorded'
                                    : state.replaceAll('_', ' ').toLowerCase(),
                              ),
                              detail(
                                'Freshness',
                                latest == null
                                    ? 'Not recorded'
                                    : fresh
                                    ? 'Current'
                                    : 'Needs refresh',
                              ),
                              detail('Accuracy', metres(latest?['accuracy_m'])),
                              detail(
                                'Position',
                                latest == null
                                    ? 'Not recorded'
                                    : '${coordinate(latest['latitude'])}, ${coordinate(latest['longitude'])}',
                              ),
                              detail(
                                'Device captured',
                                timestamp(latest?['captured_at']),
                              ),
                              detail(
                                'Server received',
                                timestamp(latest?['received_at']),
                              ),
                              if (controller.enabled &&
                                  controller.status?['can_capture'] != true)
                                Padding(
                                  padding: const EdgeInsets.only(top: 8),
                                  child: Text(
                                    '${controller.status?['reason'] ?? 'Capture is unavailable until your work location is checked.'}',
                                    style: const TextStyle(
                                      color: Color(0xFF8F3B18),
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
                      if (controller.error != null) ...[
                        const SizedBox(height: 12),
                        Semantics(
                          liveRegion: true,
                          child: Text(
                            controller.error!,
                            style: const TextStyle(color: Color(0xFFA02D38)),
                          ),
                        ),
                        if (!kIsWeb)
                          TextButton.icon(
                            onPressed: () => Geolocator.openAppSettings(),
                            icon: const Icon(Icons.settings_outlined),
                            label: const Text(
                              'Open location permission settings',
                            ),
                          ),
                      ],
                    ],
                  ),
                );
              },
            ),
    );
  }
}
