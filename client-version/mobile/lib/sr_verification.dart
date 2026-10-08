String srVerificationLabel(dynamic status) => switch (status) {
  'MATCHED' => 'Matched',
  'MISMATCH' => 'Mismatch',
  _ => 'Pending SR verification',
};
