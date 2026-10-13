import 'services.dart' show Json;

/// Current assignment comes from the authenticated member's own agent record.
/// A leader's subordinate list must never become the leader's own identity.
Json ownAgent(List<Json> agents, Json? user) {
  final agentId = user?['agent_id'];
  final userId = user?['id'];
  if (agentId != null && agentId.toString().isNotEmpty) {
    return agents.where((row) => row['id'] == agentId).firstOrNull ?? {};
  }
  if (user?['role'] == 'Field Agent' && userId != null) {
    return agents.where((row) => row['user_id'] == userId).firstOrNull ?? {};
  }
  return {};
}

String assignedLeader(Json agent) {
  final name = agent['leader']?.toString().trim();
  return name == null || name.isEmpty ? 'Not assigned' : name;
}
