/**
 * Amplify UI click-through (SAW049–054 surfaces).
 * Prefer restore for toggles; uses real Reject/Approve/Dismiss/Accept once each.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || 'https://main.d17ivsmdf92nf8.amplifyapp.com';
const OUT = process.env.SMOKE_OUT || path.join(__dirname, '..', '.smoke-click');
fs.mkdirSync(OUT, { recursive: true });

const results = [];

function log(step, ok, detail = {}) {
  const row = { step, ok, ...detail, at: new Date().toISOString() };
  results.push(row);
  console.log(JSON.stringify(row));
}

async function shot(page, name) {
  const p = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  return p;
}

async function waitUi(page, ms = 800) {
  await page.waitForTimeout(ms);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(45000);

try {
  // ── Dashboard load ──
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await waitUi(page, 1200);
  await shot(page, '01-dashboard');
  const pendingBefore = await page.locator('text=/\\d+ proposals waiting/i').first().innerText().catch(() => '');
  log('dashboard_load', true, { pendingBefore });

  // ERP deep links present + well-formed
  const erp = page.locator('a:has-text("Open in AbilityERP")').first();
  const erpCount = await page.locator('a:has-text("Open in AbilityERP")').count();
  if (erpCount < 1) {
    log('erp_deeplink_present', false, { erpCount });
  } else {
    const href = await erp.getAttribute('href');
    const ok =
      !!href &&
      href.includes('webui') &&
      (href.includes('AbERP_Rostered_Shift') || href.includes('Record_'));
    log('erp_deeplink_href', ok, { href, erpCount });
  }

  // Chat: help (AI may be offline — still must respond)
  const chatInput = page.locator('input[placeholder*="Ask" i], textarea').first();
  if ((await chatInput.count()) === 0) {
    // command bar may be a single text input near Send
    const alt = page.getByPlaceholder(/roster|help|Ask/i).first();
    if (await alt.count()) {
      await alt.fill('help');
      await page.getByRole('button', { name: /^Send$/i }).click();
    } else {
      log('chat_help', false, { error: 'no chat input' });
    }
  } else {
    await chatInput.fill('help');
    await page.getByRole('button', { name: /^Send$/i }).click();
  }
  await waitUi(page, 2500);
  const chatBody = await page.locator('body').innerText();
  const chatOk =
    /help|scan|vacant|command|AI chat is offline|OPENAI|type help/i.test(chatBody);
  await shot(page, '02-chat-help');
  log('chat_help', chatOk, { aiOfflineHint: /offline|OPENAI/i.test(chatBody) });

  // Run scan
  const scanBtn = page.getByRole('button', { name: /Run scan/i });
  await scanBtn.click();
  await page.waitForFunction(() => {
    const t = document.body.innerText;
    return /Scanning|scan|proposals|Last scan|online/i.test(t);
  });
  // wait until button not "Scanning…"
  await page.waitForFunction(() => {
    const btns = [...document.querySelectorAll('button')];
    return btns.some((b) => /Run scan/i.test(b.textContent || '')) &&
      !btns.some((b) => /Scanning/i.test(b.textContent || ''));
  }, null, { timeout: 90000 }).catch(() => {});
  await waitUi(page, 1500);
  await shot(page, '03-after-scan');
  const afterScan = await page.locator('body').innerText();
  log('run_scan', !/scan failed|unauthorized|502|503/i.test(afterScan), {
    hasLastScan: /Last scan|Last emergency|scan_run/i.test(afterScan),
  });

  // Reject first proposal (safer mutation)
  const rejectBtn = page.getByRole('button', { name: /^Reject$/i }).first();
  if ((await rejectBtn.count()) === 0) {
    log('reject_proposal', false, { error: 'no Reject button' });
  } else {
    const before = await page.locator('text=/\\d+ proposals waiting/i').first().innerText().catch(() => '');
    await rejectBtn.click();
    await waitUi(page, 2500);
    await shot(page, '04-after-reject');
    const body = await page.locator('body').innerText();
    const ok = /Rejected proposal|#|proposals waiting/i.test(body) && !/Reject failed|unauthorized/i.test(body);
    log('reject_proposal', ok, { before, afterHint: body.match(/Rejected[^\n.]*/)?.[0] });
  }

  // Approve one proposal (real assign path)
  const approveBtn = page.getByRole('button', { name: /Approve & assign/i }).first();
  if ((await approveBtn.count()) === 0) {
    log('approve_proposal', false, { error: 'no Approve button after reject' });
  } else {
    await approveBtn.click();
    await waitUi(page, 3000);
    await shot(page, '05-after-approve');
    const body = await page.locator('body').innerText();
    const ok = /Approved #|assigned|proposals waiting/i.test(body) && !/Approve failed|unauthorized|503/i.test(body);
    log('approve_proposal', ok, { note: body.match(/Approved[^\n.]*/)?.[0] });
  }

  // ── Responses ──
  await page.goto(BASE + '/responses', { waitUntil: 'networkidle' });
  await waitUi(page, 1200);
  await shot(page, '06-responses');
  log('responses_load', true, {
    open: (await page.locator('body').innerText()).match(/Open\s+(\d+)/)?.[1],
  });

  const respErp = page.locator('a:has-text("Open in AbilityERP")').first();
  if (await respErp.count()) {
    const href = await respErp.getAttribute('href');
    log('responses_erp_link', !!href && href.includes('webui'), { href });
  } else {
    log('responses_erp_link', false, { error: 'none' });
  }

  await page.getByRole('button', { name: /Run cycle/i }).click();
  await page.waitForFunction(() => !/Running…/i.test(document.body.innerText), null, {
    timeout: 90000,
  }).catch(() => {});
  await waitUi(page, 1500);
  await shot(page, '07-after-cycle');
  const cycleBody = await page.locator('body').innerText();
  log('run_cycle', /Cycle done|open \d+/i.test(cycleBody) && !/failed|unauthorized/i.test(cycleBody), {
    note: cycleBody.match(/Cycle done[^\n.]*/)?.[0],
  });

  // Dismiss first open item (IsReviewed=Y)
  const openBeforeDismiss = Number(
    (await page.locator('body').innerText()).match(/Open\s+(\d+)/)?.[1] || '0',
  );
  const dismissBtn = page.getByRole('button', { name: /^(Dismiss|Mark reviewed)$/i }).first();
  if ((await dismissBtn.count()) === 0) {
    log('dismiss_response', false, { error: 'no dismiss button' });
  } else {
    await dismissBtn.click();
    await waitUi(page, 2500);
    await shot(page, '08-after-dismiss');
    const body = await page.locator('body').innerText();
    const openAfter = Number(body.match(/Open\s+(\d+)/)?.[1] || '0');
    const note = body.match(/Dismissed response[^\n.]*/i)?.[0] || body.match(/error[^\n]*/i)?.[0];
    log('dismiss_response', /Dismissed response #\d+/i.test(body) && !/Dismiss failed/i.test(body), {
      openBeforeDismiss,
      openAfter,
      note,
    });
  }

  // Accept & assign — first Accept button only (avoid nested locator strictness)
  const acceptBtn = page.getByRole('button', { name: /Accept & assign/i }).first();
  if ((await acceptBtn.count()) === 0) {
    log('accept_response', false, { error: 'no Accept button (queue empty or all dismissed)' });
  } else {
    const openBeforeAccept = Number(
      (await page.locator('body').innerText()).match(/Open\s+(\d+)/)?.[1] || '0',
    );
    await acceptBtn.click();
    await waitUi(page, 3500);
    await shot(page, '09-after-accept');
    const body = await page.locator('body').innerText();
    const openAfterAccept = Number(body.match(/Open\s+(\d+)/)?.[1] || '0');
    const accepted = /Accepted response #\d+/i.test(body);
    const softFail = /Accept failed|no vacant|already assigned|not vacant/i.test(body);
    log('accept_response', accepted || softFail, {
      softFail,
      openBeforeAccept,
      openAfterAccept,
      note: body.match(/(Accepted response|Accept failed)[^\n.]*/i)?.[0],
    });
  }

  // ── Rules ──
  await page.goto(BASE + '/rules', { waitUntil: 'networkidle' });
  await waitUi(page, 1200);
  await shot(page, '10-rules');
  log('rules_load', /Roster rules|Min break|Max weekly/i.test(await page.locator('body').innerText()));

  // Toggle Max shift length — scope to section.rules-card only
  const maxShiftCard = page.locator('section.rules-card').filter({ hasText: /Max shift length|Max shift hours/i }).first();
  await maxShiftCard.waitFor({ state: 'visible' });
  const enableBtn = maxShiftCard.getByRole('button', { name: /^Enable$/i });
  const disableBtn = maxShiftCard.getByRole('button', { name: /^Disable$/i });
  if (await enableBtn.count()) {
    await enableBtn.click();
    await waitUi(page, 1500);
    await shot(page, '11-rule-enabled');
    const enabledOk = (await maxShiftCard.getByRole('button', { name: /^Disable$/i }).count()) > 0;
    log('rule_enable', enabledOk);
    await maxShiftCard.getByRole('button', { name: /^Disable$/i }).click();
    await waitUi(page, 1500);
    await shot(page, '12-rule-restored');
    log('rule_disable_restore', (await maxShiftCard.getByRole('button', { name: /^Enable$/i }).count()) > 0);
  } else if (await disableBtn.count()) {
    await disableBtn.click();
    await waitUi(page, 1500);
    await maxShiftCard.getByRole('button', { name: /^Enable$/i }).click();
    await waitUi(page, 1500);
    log('rule_toggle_roundtrip', true, { startedAs: 'On' });
  } else {
    log('rule_toggle', false, { error: 'no Enable/Disable on max shift card' });
  }

  // Edit min break → Save rule
  const breakCard = page.locator('section.rules-card').filter({ hasText: /Min break between shifts/i }).first();
  await breakCard.getByRole('button', { name: /^Edit$/i }).click();
  await waitUi(page, 800);
  await shot(page, '13-rule-edit-open');
  const saveBtn = page.getByRole('button', { name: /Save rule/i }).first();
  if ((await saveBtn.count()) === 0) {
    log('rule_edit_save', false, { error: 'no Save rule button' });
  } else {
    const num = page.locator('[role="dialog"] input[type="number"], .rules-modal input[type="number"]').first();
    let original = null;
    if (await num.count()) {
      original = await num.inputValue();
      await num.fill(String(Number(original) || 10));
    }
    await saveBtn.click();
    await waitUi(page, 1500);
    await shot(page, '14-rule-edit-saved');
    const body = await page.locator('body').innerText();
    log('rule_edit_save', !/Save failed|unauthorized/i.test(body) && (await page.getByRole('button', { name: /Save rule/i }).count()) === 0, {
      original,
    });
  }

  // Skills page — response_review visible
  await page.goto(BASE + '/skills', { waitUntil: 'networkidle' });
  await waitUi(page, 1000);
  await shot(page, '15-skills');
  const skillsText = await page.locator('body').innerText();
  log('skills_response_review', /Response Log Review|response_review/i.test(skillsText));

  // Planner / Gaps quick load
  await page.goto(BASE + '/planner', { waitUntil: 'networkidle' });
  await waitUi(page, 1000);
  log('planner_load', /FILL RATE|This period|Run briefing/i.test(await page.locator('body').innerText()));
  await page.goto(BASE + '/gaps', { waitUntil: 'networkidle' });
  await waitUi(page, 1000);
  log('gaps_load', /Gaps|training|blocked/i.test(await page.locator('body').innerText()));
} catch (e) {
  log('suite_crash', false, { error: String(e) });
  await shot(page, '99-crash').catch(() => {});
} finally {
  const report = {
    base: BASE,
    at: new Date().toISOString(),
    pass: results.filter((r) => r.ok).length,
    fail: results.filter((r) => !r.ok).length,
    results,
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('SUMMARY', JSON.stringify({ pass: report.pass, fail: report.fail, failed: results.filter((r) => !r.ok).map((r) => r.step) }));
  await browser.close();
  process.exit(report.fail ? 1 : 0);
}
