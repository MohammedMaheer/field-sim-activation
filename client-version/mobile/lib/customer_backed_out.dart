import 'package:flutter/material.dart';
import 'services.dart';
import 'saved_drafts.dart';
import 'typography.dart';

/// Record an unfinished attempt before removing its local draft. This deliberately
/// does not queue offline: the server must first rule out an accepted sale.
Future<bool> showCustomerBackedOutSheet(
  BuildContext context, {
  required RelayService service,
  required Json intake,
  required int version,
}) async =>
    await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      isDismissible: false,
      enableDrag: false,
      useSafeArea: true,
      builder: (_) => _CustomerBackedOutSheet(
        service: service,
        intake: Map<String, dynamic>.from(intake),
        version: version,
      ),
    ) ??
    false;

class _CustomerBackedOutSheet extends StatefulWidget {
  const _CustomerBackedOutSheet({
    required this.service,
    required this.intake,
    required this.version,
  });
  final RelayService service;
  final Json intake;
  final int version;

  @override
  State<_CustomerBackedOutSheet> createState() => _CustomerBackedOutState();
}

class _CustomerBackedOutState extends State<_CustomerBackedOutSheet> {
  final note = TextEditingController();
  bool saving = false;
  String? error;
  late final Object? accountId;

  @override
  void initState() {
    super.initState();
    accountId = widget.service.user?['id'];
  }

  @override
  void dispose() {
    note.dispose();
    super.dispose();
  }

  Future<void> record() async {
    if (saving) return;
    setState(() {
      saving = true;
      error = null;
    });
    try {
      if (accountId == null || widget.service.user?['id'] != accountId) {
        throw StateError('The sign-in session changed.');
      }
      final agentId = (widget.service.user?['agent_id'] ?? '')
          .toString()
          .trim();
      if (agentId.isEmpty) {
        setState(() {
          error =
              'No sales agent is assigned to this account. Ask an '
              'administrator to set the assignment, then try again. '
              'Your draft is kept here.';
        });
        return;
      }
      // The outcome retains customer and product details, without reuploading
      // photographs or OCR credentials that are not needed for no-sale feedback.
      final details = Map<String, dynamic>.from(widget.intake)
        ..removeWhere(
          (key, _) => const {
            'document_image',
            'order_image',
            'selfie_image',
            'payment_image',
            'document_check',
            'order_check',
            'receipt_sr_check',
            'signature',
          }.contains(key),
        );
      final response = await widget.service.dio.post(
        '/kyc-captures/customer-backed-out',
        data: {
          'agent_id': agentId,
          'transaction_id': details['transaction_id'],
          'version': widget.version,
          'data': details,
          'note': note.text.trim(),
        },
      );
      if (response.data is! Map || response.data['recorded'] != true) {
        throw StateError('The outcome was not recorded.');
      }
      if (widget.service.user?['id'] != accountId) return;
      await removeClosedCaptureDrafts(widget.service, widget.intake);
      if (mounted && widget.service.user?['id'] == accountId) {
        Navigator.pop(context, true);
      }
    } catch (failure) {
      if (mounted) {
        setState(() {
          error =
              failure is StateError && widget.service.user?['id'] != accountId
              ? 'Your sign-in session changed. Open this page again in your current account.'
              : '${friendlyError(failure)} Your draft is kept here; try again or keep editing.';
        });
      }
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !saving,
    child: Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Customer backed out?',
                style: RelayTypography.section,
              ),
              const SizedBox(height: 10),
              const Text(
                'Save a no-sale record with the customer name, phone number '
                'and product entered so far, then close this draft. '
                'No sale or activation will be created.',
                style: RelayTypography.body,
              ),
              const SizedBox(height: 16),
              TextField(
                controller: note,
                enabled: !saving,
                minLines: 2,
                maxLines: 4,
                maxLength: 1000,
                decoration: const InputDecoration(
                  labelText: 'Note · optional',
                  hintText: 'For example, the customer needs more time.',
                  alignLabelWithHint: true,
                ),
              ),
              if (error != null) ...[
                const SizedBox(height: 8),
                Semantics(
                  liveRegion: true,
                  child: Text(
                    error!,
                    style: RelayTypography.body.copyWith(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: saving ? null : record,
                icon: saving
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.person_off_outlined, size: 20),
                label: Text(
                  saving ? 'Recording…' : 'Record customer backed out',
                ),
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: saving ? null : () => Navigator.pop(context, false),
                child: const Text('Keep editing'),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}
