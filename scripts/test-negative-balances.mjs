#!/usr/bin/env node
/**
 * Block 08 dry-run: simulate negative-balance carry-over + finalize-if-
 * negative + idempotent recalc. No DB. Replicates the JS-equivalent
 * arithmetic of src/lib/payroll/negativeBalances.ts.
 *
 * If you change the helper rules there, mirror them here.
 */

function statusForCollected(collected, original) {
  if (collected >= original) return 'FULLY_COLLECTED';
  if (collected > 0) return 'PARTIALLY_COLLECTED';
  return 'PENDING';
}

function applyPending(balances, startingTotal) {
  let running = startingTotal;
  const lines = [];
  if (running <= 0) {
    return { totalAfter: running, lines, balances };
  }
  for (const bal of balances) {
    if (running <= 0) break;
    if (bal.status === 'FULLY_COLLECTED' || bal.status === 'MANUALLY_DELETED') continue;
    const remaining = bal.original_amount - bal.collected_amount;
    if (remaining <= 0) continue;
    const toCollect = Math.min(remaining, running);
    const isFull = toCollect >= remaining;
    lines.push({
      line_type: 'NEGATIVE_BALANCE_COLLECTION',
      source_negative_balance_id: bal.id,
      amount: -toCollect,
      description: `Saldo negativo PF ${bal.origin_week} ${isFull ? 'completo' : 'parcial'}`,
    });
    bal.collected_amount += toCollect;
    bal.status = statusForCollected(bal.collected_amount, bal.original_amount);
    running -= toCollect;
  }
  return { totalAfter: running, lines, balances };
}

function finalize(payfile, runningTotal) {
  if (runningTotal >= 0) {
    payfile.total_amount = runningTotal;
    payfile.had_negative_balance = false;
    return { newBalance: null };
  }
  const absRes = Math.abs(runningTotal);
  payfile.total_amount = 0;
  payfile.had_negative_balance = true;
  return {
    newBalance: {
      id: `new-${payfile.id}`,
      user_id: payfile.user_id,
      original_amount: absRes,
      collected_amount: 0,
      status: 'PENDING',
      origin_week: payfile.pay_week,
      auto_generated_for_payfile_id: payfile.id,
    },
  };
}

function assert(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) {
    console.log('  expected:', JSON.stringify(expected));
    console.log('  actual  :', JSON.stringify(actual));
  }
  return ok;
}
let pass = true;
function check(label, a, e) { pass = assert(label, a, e) && pass; }

// ── Scenario 1: payfile $200, prior balance $300 → partial collect ──────────
{
  const bal = { id: 'b1', origin_week: '2026-05-01', original_amount: 300, collected_amount: 0, status: 'PENDING' };
  const { totalAfter, lines } = applyPending([bal], 200);
  check('S1 line amount = -200', lines.map((l) => l.amount), [-200]);
  check('S1 balance collected = 200', bal.collected_amount, 200);
  check('S1 balance status PARTIALLY_COLLECTED', bal.status, 'PARTIALLY_COLLECTED');
  check('S1 running after = 0', totalAfter, 0);
}

// ── Scenario 2: payfile $500, prior balance $100 → full collect ────────────
{
  const bal = { id: 'b2', origin_week: '2026-05-01', original_amount: 100, collected_amount: 0, status: 'PENDING' };
  const { totalAfter, lines } = applyPending([bal], 500);
  check('S2 line amount = -100', lines.map((l) => l.amount), [-100]);
  check('S2 balance FULLY_COLLECTED', bal.status, 'FULLY_COLLECTED');
  check('S2 running after = 400', totalAfter, 400);
}

// ── Scenario 3: payfile negative, no carry-over → new balance + force 0 ────
{
  const pf = { id: 'pf3', user_id: 'u3', pay_week: '2026-05-15', total_amount: 0, had_negative_balance: false };
  const { newBalance } = finalize(pf, -50);
  check('S3 payfile total forced to 0', pf.total_amount, 0);
  check('S3 had_negative_balance = true', pf.had_negative_balance, true);
  check('S3 new balance amount = 50', newBalance?.original_amount, 50);
  check('S3 new balance tagged auto_generated_for_payfile_id', newBalance?.auto_generated_for_payfile_id, 'pf3');
}

// ── Scenario 4: payfile positive after carry-over residual → no new balance ─
{
  const bal = { id: 'b4', origin_week: '2026-04-24', original_amount: 100, collected_amount: 0, status: 'PENDING' };
  const apply = applyPending([bal], 80);   // can only pay 80 of the 100 balance
  const pf = { id: 'pf4', user_id: 'u4', pay_week: '2026-05-15', total_amount: 0, had_negative_balance: false };
  const finalizeRes = finalize(pf, apply.totalAfter);
  check('S4 running after = 0', apply.totalAfter, 0);
  check('S4 balance partially', bal.status, 'PARTIALLY_COLLECTED');
  check('S4 balance remaining (orig-coll) = 20', bal.original_amount - bal.collected_amount, 20);
  check('S4 no new balance', finalizeRes.newBalance, null);
  check('S4 payfile total = 0', pf.total_amount, 0);
}

// ── Scenario 5: carry-over not enough → payfile negative again, new balance ─
{
  const bal = { id: 'b5', origin_week: '2026-04-24', original_amount: 100, collected_amount: 0, status: 'PENDING' };
  // Starting -50, balance can't apply (running<=0 short-circuits), then finalize creates new.
  const apply = applyPending([bal], -50);
  const pf = { id: 'pf5', user_id: 'u5', pay_week: '2026-05-15', total_amount: 0, had_negative_balance: false };
  const finalizeRes = finalize(pf, apply.totalAfter);
  check('S5 no carry-over applied (running was already < 0)', apply.lines.length, 0);
  check('S5 prior balance untouched (still 0 collected)', bal.collected_amount, 0);
  check('S5 new balance created', !!finalizeRes.newBalance, true);
  check('S5 new balance amount = 50', finalizeRes.newBalance?.original_amount, 50);
}

// ── Scenario 6: idempotency — second-pass on same state produces same delta ─
{
  // First pass: collect 200 of 300.
  const bal = { id: 'b6', origin_week: '2026-05-01', original_amount: 300, collected_amount: 0, status: 'PENDING' };
  const first = applyPending([bal], 200);
  // Simulate wipe (revert collected_amount on the linked balance).
  bal.collected_amount -= Math.abs(first.lines[0].amount);
  bal.status = statusForCollected(bal.collected_amount, bal.original_amount);
  // Second pass with the SAME starting total.
  const second = applyPending([bal], 200);
  check('S6 idempotency: same line amount', second.lines[0].amount, -200);
  check('S6 idempotency: same collected after', bal.collected_amount, 200);
  check('S6 idempotency: same status after', bal.status, 'PARTIALLY_COLLECTED');
}

// ── Scenario 7: multiple balances oldest-first ─────────────────────────────
{
  const older = { id: 'b7a', origin_week: '2026-04-10', original_amount: 100, collected_amount: 0, status: 'PENDING' };
  const newer = { id: 'b7b', origin_week: '2026-05-01', original_amount: 200, collected_amount: 0, status: 'PENDING' };
  const { lines, totalAfter } = applyPending([older, newer], 150);
  check('S7 first line drains older $100', lines[0].amount, -100);
  check('S7 second line takes $50 of newer', lines[1].amount, -50);
  check('S7 older fully collected', older.status, 'FULLY_COLLECTED');
  check('S7 newer partially', newer.status, 'PARTIALLY_COLLECTED');
  check('S7 running = 0', totalAfter, 0);
}

console.log(pass ? '\n✓ all dry-run scenarios pass' : '\n✗ some scenarios failed');
process.exit(pass ? 0 : 1);
