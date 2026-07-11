import assert from 'assert';
import test from 'node:test';

// Exact duplicate check logic from page.tsx
function checkDuplicate(tickets: any[], parsedActions: any[]): { hasDuplicate: boolean; duplicateTitle: string } {
  let hasDuplicate = false;
  let duplicateTitle = '';

  for (const action of parsedActions) {
    if (action.type === 'add_ticket' || action.type === 'add_bug_ticket') {
      const title = action.payload.title.toLowerCase().trim();
      const exists = tickets.some(t => t.title.toLowerCase().trim() === title);
      if (exists) {
        hasDuplicate = true;
        duplicateTitle = action.payload.title;
        break;
      }
    }
  }
  return { hasDuplicate, duplicateTitle };
}

test('Duplicate Ticket Detection Check', () => {
  const existingTickets = [
    { title: 'API rate limiting', status: 'backlog' },
    { title: 'User authentication', status: 'done' }
  ];

  // Test Case 1: Unique ticket
  const actions1 = [
    { type: 'add_ticket', payload: { title: 'Implement database connection pooling' } }
  ];
  const res1 = checkDuplicate(existingTickets, actions1);
  assert.strictEqual(res1.hasDuplicate, false, 'Should allow unique ticket titles');

  // Test Case 2: Duplicate of open backlog ticket
  const actions2 = [
    { type: 'add_ticket', payload: { title: '  API rate limiting  ' } }
  ];
  const res2 = checkDuplicate(existingTickets, actions2);
  assert.strictEqual(res2.hasDuplicate, true, 'Should detect duplicate of backlog ticket');
  assert.strictEqual(res2.duplicateTitle, '  API rate limiting  ');

  // Test Case 3: Duplicate of completed ticket
  const actions3 = [
    { type: 'add_bug_ticket', payload: { title: 'User Authentication' } }
  ];
  const res3 = checkDuplicate(existingTickets, actions3);
  assert.strictEqual(res3.hasDuplicate, true, 'Should detect duplicate of completed done ticket');

  console.log('✅ All duplicate check unit tests passed successfully!');
});
