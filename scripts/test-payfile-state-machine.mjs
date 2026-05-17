#!/usr/bin/env node
/**
 * Block 11 dry-run: verify the state-machine transitions in JS.
 * No DB. Mirrors payfileTransitions.ts decision logic.
 */

const REPUBLISH_THRESHOLD = 500;

// Simulated payfile + diff.
function transitionAllowed(state, to, actorRole, ctx = {}) {
  const adminOrCeo = actorRole === 'admin' || actorRole === 'ceo';
  const ceo = actorRole === 'ceo';

  if (to === 'PENDING_APPROVAL') {
    if (!adminOrCeo) return { ok: false, reason: 'role' };
    if (state !== 'DRAFT' && state !== 'REJECTED') return { ok: false, reason: 'wrong_state' };
    if (!ctx.canPublish) return { ok: false, reason: 'gate_failed' };
    if (!ctx.hasLines) return { ok: false, reason: 'empty' };
    return { ok: true };
  }
  if (to === 'PUBLISHED_via_approve') {
    if (!ceo) return { ok: false, reason: 'role' };
    if (state !== 'PENDING_APPROVAL') return { ok: false, reason: 'wrong_state' };
    if (!ctx.canPublish) return { ok: false, reason: 'gate_failed' };
    return { ok: true };
  }
  if (to === 'DRAFT_via_reject') {
    if (!ceo) return { ok: false, reason: 'role' };
    if (state !== 'PENDING_APPROVAL') return { ok: false, reason: 'wrong_state' };
    if (!ctx.notes) return { ok: false, reason: 'notes_required' };
    return { ok: true };
  }
  if (to === 'DRAFT_via_reopen') {
    if (!adminOrCeo) return { ok: false, reason: 'role' };
    if (state !== 'PUBLISHED' && state !== 'APPROVED') return { ok: false, reason: 'wrong_state' };
    return { ok: true };
  }
  if (to === 'PUBLISHED_via_republish') {
    if (!adminOrCeo) return { ok: false, reason: 'role' };
    if (state !== 'DRAFT' && state !== 'REJECTED') return { ok: false, reason: 'wrong_state' };
    if (!ctx.canPublish) return { ok: false, reason: 'gate_failed' };
    if (ctx.isFirstPublish) return { ok: false, reason: 'first_publish_needs_ceo' };
    if (ctx.absDiff > REPUBLISH_THRESHOLD) return { ok: false, reason: 'over_threshold' };
    return { ok: true };
  }
  return { ok: false, reason: 'unknown_target' };
}

let pass = true;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) console.log('  expected:', expected, 'actual:', actual);
  pass = ok && pass;
}

// 1. Submit happy path
check('Admin submits DRAFT with valid gate', transitionAllowed('DRAFT', 'PENDING_APPROVAL', 'admin', { canPublish: true, hasLines: true }), { ok: true });
check('Admin submits empty DRAFT fails', transitionAllowed('DRAFT', 'PENDING_APPROVAL', 'admin', { canPublish: true, hasLines: false }), { ok: false, reason: 'empty' });
check('Admin submits failing gate', transitionAllowed('DRAFT', 'PENDING_APPROVAL', 'admin', { canPublish: false, hasLines: true }), { ok: false, reason: 'gate_failed' });
check('Agent cannot submit', transitionAllowed('DRAFT', 'PENDING_APPROVAL', 'agent', { canPublish: true, hasLines: true }), { ok: false, reason: 'role' });
check('Admin submits PUBLISHED fails (wrong state)', transitionAllowed('PUBLISHED', 'PENDING_APPROVAL', 'admin', { canPublish: true, hasLines: true }), { ok: false, reason: 'wrong_state' });

// 2. Approve
check('CEO approves PENDING_APPROVAL with valid gate', transitionAllowed('PENDING_APPROVAL', 'PUBLISHED_via_approve', 'ceo', { canPublish: true }), { ok: true });
check('Admin cannot approve', transitionAllowed('PENDING_APPROVAL', 'PUBLISHED_via_approve', 'admin', { canPublish: true }), { ok: false, reason: 'role' });
check('CEO approve fails gate', transitionAllowed('PENDING_APPROVAL', 'PUBLISHED_via_approve', 'ceo', { canPublish: false }), { ok: false, reason: 'gate_failed' });

// 3. Reject
check('CEO rejects with notes', transitionAllowed('PENDING_APPROVAL', 'DRAFT_via_reject', 'ceo', { notes: 'Fix x' }), { ok: true });
check('CEO rejects without notes fails', transitionAllowed('PENDING_APPROVAL', 'DRAFT_via_reject', 'ceo', { notes: '' }), { ok: false, reason: 'notes_required' });
check('CEO rejects DRAFT fails (wrong state)', transitionAllowed('DRAFT', 'DRAFT_via_reject', 'ceo', { notes: 'x' }), { ok: false, reason: 'wrong_state' });

// 4. Reopen
check('Admin reopens PUBLISHED', transitionAllowed('PUBLISHED', 'DRAFT_via_reopen', 'admin', {}), { ok: true });
check('Admin reopens DRAFT fails', transitionAllowed('DRAFT', 'DRAFT_via_reopen', 'admin', {}), { ok: false, reason: 'wrong_state' });
check('Agent cannot reopen', transitionAllowed('PUBLISHED', 'DRAFT_via_reopen', 'agent', {}), { ok: false, reason: 'role' });

// 5. Republish (THE $500 rule)
check('Republish small change (Δ=$300) OK', transitionAllowed('DRAFT', 'PUBLISHED_via_republish', 'admin', { canPublish: true, isFirstPublish: false, absDiff: 300 }), { ok: true });
check('Republish boundary (Δ=$500) OK', transitionAllowed('DRAFT', 'PUBLISHED_via_republish', 'admin', { canPublish: true, isFirstPublish: false, absDiff: 500 }), { ok: true });
check('Republish over threshold (Δ=$501) blocked', transitionAllowed('DRAFT', 'PUBLISHED_via_republish', 'admin', { canPublish: true, isFirstPublish: false, absDiff: 501 }), { ok: false, reason: 'over_threshold' });
check('Republish first publish blocked (must go via CEO)', transitionAllowed('DRAFT', 'PUBLISHED_via_republish', 'admin', { canPublish: true, isFirstPublish: true, absDiff: 0 }), { ok: false, reason: 'first_publish_needs_ceo' });
check('Republish fails gate', transitionAllowed('DRAFT', 'PUBLISHED_via_republish', 'admin', { canPublish: false, isFirstPublish: false, absDiff: 100 }), { ok: false, reason: 'gate_failed' });

console.log(pass ? '\n✓ all dry-run scenarios pass' : '\n✗ some scenarios failed');
process.exit(pass ? 0 : 1);
