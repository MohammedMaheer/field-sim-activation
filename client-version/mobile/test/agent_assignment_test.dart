import 'package:flutter_test/flutter_test.dart';
import 'package:relay_agent/agent_assignment.dart';

void main() {
  final agents = [
    {'id': 'other', 'user_id': 'other-account', 'leader': 'Other leader'},
    {'id': 'own', 'user_id': 'own-account', 'leader': 'Own leader'},
  ];
  test('uses designated leader from own record even when it is not first', () {
    expect(
      assignedLeader(
        ownAgent(agents, {
          'id': 'own-account',
          'agent_id': 'own',
          'role': 'Field Agent',
        }),
      ),
      'Own leader',
    );
  });
  test('a leader does not inherit subordinate assignment', () {
    expect(
      ownAgent(agents, {'id': 'leader-account', 'role': 'Team Leader'}),
      isEmpty,
    );
  });
  test('missing own record never borrows another member or branch leader', () {
    expect(
      ownAgent(agents, {
        'agent_id': 'missing',
        'id': 'own-account',
        'role': 'Field Agent',
      }),
      isEmpty,
    );
    expect(assignedLeader({}), 'Not assigned');
    expect(assignedLeader({'leader': '  '}), 'Not assigned');
  });
  test('older identity payload can match explicit own user ID', () {
    expect(
      assignedLeader(
        ownAgent(agents, {'id': 'own-account', 'role': 'Field Agent'}),
      ),
      'Own leader',
    );
  });
}
