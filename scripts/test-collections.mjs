#!/usr/bin/env node
/**
 * Block 09 dry-run: simulate installment generation, apply,
 * partial-collect, beneficiary credit, CEO special case, cancel.
 * No DB. Mirrors src/lib/payroll/collections.ts logic in JS.
 */

function statusForCollected(collected, amount) {
  if (collected >= amount) return 'FULLY_COLLECTED';
  if (collected > 0) return 'PARTIALLY_COLLECTED';
  return 'PENDING';
}

function addWeeks(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n * 7);
  return d.toISOString().slice(0, 10);
}

function computeInstallments(total, n, startWeek) {
  const totalCents = Math.round(total * 100);
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n;
  const out = [];
  for (let i = 0; i < n; i++) {
    const isLast = i === n - 1;
    const cents = base + (isLast ? remainder : 0);
    out.push({ scheduled_week: addWeeks(startWeek, i), amount: cents / 100 });
  }
  return out;
}

function applyInstallments(installments, runningTotal, payWeek) {
  // installments[i] = { id, installment_number, scheduled_week, amount,
  //                     collected_amount, status, collection: { description, beneficiary_id, role, installments } }
  const lines = [];
  const credits = [];
  let running = runningTotal;
  if (running <= 0) return { running, lines, credits };

  // Filter eligible.
  const eligible = installments.filter(
    (i) => (i.status === 'PENDING' || i.status === 'PARTIALLY_COLLECTED') && i.scheduled_week <= payWeek,
  );
  eligible.sort((a, b) => a.scheduled_week < b.scheduled_week ? -1 : a.scheduled_week > b.scheduled_week ? 1 :
                          a.installment_number - b.installment_number);

  for (const inst of eligible) {
    if (running <= 0) break;
    const remaining = inst.amount - inst.collected_amount;
    if (remaining <= 0) continue;
    const toCollect = Math.min(remaining, running);
    lines.push({
      installment_id: inst.id,
      amount: -toCollect,
      description: `Cobro: ${inst.collection.description} parcialidad ${inst.installment_number}/${inst.collection.installments}`,
    });
    inst.collected_amount += toCollect;
    inst.status = statusForCollected(inst.collected_amount, inst.amount);
    credits.push({
      beneficiary_id: inst.collection.beneficiary_id,
      beneficiary_role: inst.collection.role,
      amount: toCollect,
      description: `Abono: ${inst.collection.description} parcialidad ${inst.installment_number}/${inst.collection.installments}`,
    });
    running -= toCollect;
  }
  return { running, lines, credits };
}

let pass = true;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) {
    console.log('  expected:', JSON.stringify(expected));
    console.log('  actual  :', JSON.stringify(actual));
  }
  pass = ok && pass;
}

// ── Scenario 1: $100 / 5 parcialidades → 5 rows of $20 ────────────────────
{
  const insts = computeInstallments(100, 5, '2026-05-15');
  check('S1 5 installments generated', insts.length, 5);
  check('S1 each $20', insts.map((i) => i.amount), [20, 20, 20, 20, 20]);
  check('S1 weeks spaced', insts.map((i) => i.scheduled_week),
    ['2026-05-15', '2026-05-22', '2026-05-29', '2026-06-05', '2026-06-12']);
}

// ── Scenario 2: $100 / 3 → 33.33, 33.33, 33.34 ────────────────────────────
{
  const insts = computeInstallments(100, 3, '2026-05-15');
  check('S2 3 installments', insts.length, 3);
  check('S2 last absorbs remainder', insts.map((i) => i.amount), [33.33, 33.33, 33.34]);
  check('S2 sum to total', insts.reduce((acc, i) => acc + i.amount, 0).toFixed(2), '100.00');
}

// ── Scenario 3: Apply 1st installment, debtor has $500 → full collect + credit ─
{
  const installments = [
    { id: 'i1', installment_number: 1, scheduled_week: '2026-05-15', amount: 20, collected_amount: 0, status: 'PENDING',
      collection: { description: 'Loan A', beneficiary_id: 'b1', role: 'agent', installments: 5 } },
  ];
  const r = applyInstallments(installments, 500, '2026-05-15');
  check('S3 line -20', r.lines.map((l) => l.amount), [-20]);
  check('S3 installment FULLY_COLLECTED', installments[0].status, 'FULLY_COLLECTED');
  check('S3 running 480', r.running, 480);
  check('S3 credit +20', r.credits.map((c) => c.amount), [20]);
}

// ── Scenario 4: Debtor has $5 of $20 owed → partial ────────────────────────
{
  const installments = [
    { id: 'i1', installment_number: 2, scheduled_week: '2026-05-22', amount: 20, collected_amount: 0, status: 'PENDING',
      collection: { description: 'Loan A', beneficiary_id: 'b1', role: 'agent', installments: 5 } },
  ];
  const r = applyInstallments(installments, 5, '2026-05-22');
  check('S4 line -5', r.lines.map((l) => l.amount), [-5]);
  check('S4 PARTIALLY_COLLECTED', installments[0].status, 'PARTIALLY_COLLECTED');
  check('S4 running 0', r.running, 0);
  check('S4 credit +5', r.credits.map((c) => c.amount), [5]);
}

// ── Scenario 5: Multiple installments + catch up missed ────────────────────
{
  const installments = [
    { id: 'i1', installment_number: 1, scheduled_week: '2026-05-08', amount: 20, collected_amount: 0, status: 'PENDING',
      collection: { description: 'Loan A', beneficiary_id: 'b1', role: 'agent', installments: 5 } },
    { id: 'i2', installment_number: 2, scheduled_week: '2026-05-15', amount: 20, collected_amount: 0, status: 'PENDING',
      collection: { description: 'Loan A', beneficiary_id: 'b1', role: 'agent', installments: 5 } },
  ];
  // Pay week is 2026-05-15. Debtor has $50. Should catch up the older one + pay current.
  const r = applyInstallments(installments, 50, '2026-05-15');
  check('S5 two collections (catch up + current)', r.lines.length, 2);
  check('S5 amounts', r.lines.map((l) => l.amount), [-20, -20]);
  check('S5 both FULLY_COLLECTED', installments.map((i) => i.status), ['FULLY_COLLECTED', 'FULLY_COLLECTED']);
  check('S5 running 10', r.running, 10);
}

// ── Scenario 6: Debtor has $0 → no apply ───────────────────────────────────
{
  const installments = [
    { id: 'i1', installment_number: 1, scheduled_week: '2026-05-15', amount: 20, collected_amount: 0, status: 'PENDING',
      collection: { description: 'Loan A', beneficiary_id: 'b1', role: 'agent', installments: 5 } },
  ];
  const r = applyInstallments(installments, 0, '2026-05-15');
  check('S6 no lines', r.lines.length, 0);
  check('S6 still PENDING', installments[0].status, 'PENDING');
}

// ── Scenario 7: CEO beneficiary — credit routes via separate role tag ──────
{
  const installments = [
    { id: 'i1', installment_number: 1, scheduled_week: '2026-05-15', amount: 50, collected_amount: 0, status: 'PENDING',
      collection: { description: 'Loan B', beneficiary_id: 'ceo-user', role: 'ceo', installments: 4 } },
  ];
  const r = applyInstallments(installments, 100, '2026-05-15');
  check('S7 credit beneficiary_role = ceo', r.credits[0]?.beneficiary_role, 'ceo');
  // In production the orchestrator would route this to company_bonuses
  // instead of a payfile line item. The dry-run only verifies the buffer.
}

// ── Scenario 8: Cancelled collection — orchestrator filters by status='ACTIVE' ─
{
  // The apply query joins on collections.status='ACTIVE'. Cancelled
  // collections never enter the input. Mirror by filtering here.
  const installments = [
    { id: 'i1', installment_number: 1, scheduled_week: '2026-05-15', amount: 50, collected_amount: 0, status: 'PENDING',
      collection: { description: 'Loan C', beneficiary_id: 'b1', role: 'agent', installments: 1, status: 'CANCELLED' } },
  ].filter((i) => i.collection.status !== 'CANCELLED');
  const r = applyInstallments(installments, 200, '2026-05-15');
  check('S8 cancelled skipped: no lines', r.lines.length, 0);
}

console.log(pass ? '\n✓ all dry-run scenarios pass' : '\n✗ some scenarios failed');
process.exit(pass ? 0 : 1);
