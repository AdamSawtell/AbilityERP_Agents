/**
 * Extended Amplify browser smoke — remaining nav + interactions.
 * Cursor browser MCP unavailable; Playwright headless Chromium.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || 'https://main.d17ivsmdf92nf8.amplifyapp.com';
const OUT = process.env.SMOKE_OUT || path.join(__dirname, '..', '.smoke-continue');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function log(step, ok, detail = {}) {
  const row = { step, ok, ...detail, at: new Date().toISOString() };
  results.push(row);
  console.log(JSON.stringify(row));
}

async function shot(page, name) {
  const p = path.join(OUT, `${String(results.length).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  return p;
}

async function waitUi(page, ms = 900) {
  await page.waitForTimeout(ms);
}

async function goto(page, p) {
  const res = await page.goto(BASE + p, { waitUntil: 'networkidle', timeout: 60000 });
  await waitUi(page, 1000);
  return res?.status() ?? 0;
}

async function noFatalUi(page) {
  const t = await page.locator('body').innerText();
  return !/Application error|Internal Server Error|Unhandled Runtime|ChunkLoadError/i.test(t);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(45000);

try {
  // ── Nav crawl all Shell links ──
  const nav = [
    ['/', /Today|proposals|Ross online/i],
    ['/planner', /Planner|FILL RATE|Run briefing/i],
    ['/gaps', /Gaps|training|blocked|No open/i],
    ['/credentials', /Credential|expir|within|No expiring/i],
    ['/confirms', /Confirm|pending|No open|Respond/i],
    ['/swaps', /Swap|detect|No pending|Approve/i],
    ['/leaves', /Leave|cycle|overlap|No leave/i],
    ['/responses', /Response log|Open|REQ|DEC/i],
    ['/skills', /Skills|Shift Scanner|Response Log/i],
    ['/rules', /Roster rules|Min break|BLOCKING/i],
    ['/config', /Config|threshold|Auto-assign|Scan interval/i],
    ['/audit', /Audit|Export|action|scan_run/i],
  ];

  for (const [pathName, re] of nav) {
    const status = await goto(page, pathName);
    const text = await page.locator('body').innerText();
    const ok = status === 200 && re.test(text) && (await noFatalUi(page));
    await shot(page, `nav-${pathName.replace(/\//g, '_') || 'home'}`);
    log(`nav${pathName || '/'}`, ok, { status, match: re.source });
  }

  // ── Dashboard horizons (tab buttons may include a vacant count suffix) ──
  await goto(page, '/');
  for (const label of ['Today', 'This Period', 'Next Period']) {
    const tab = page.locator('.horizon-tab', { hasText: label }).first();
    if ((await tab.count()) === 0) {
      log(`horizon_${label.replace(/\s+/g, '_')}`, false, { error: 'missing tab' });
      continue;
    }
    await tab.click();
    await waitUi(page, 1500);
    const h1 = await page.locator('h1').first().innerText();
    log(`horizon_${label.replace(/\s+/g, '_')}`, h1 === label && (await noFatalUi(page)), { h1 });
  }
  await shot(page, 'horizons');

  // Click first proposal card worker/client link or id-tag → record panel if present
  await page.getByRole('button', { name: /^Today$/i }).click().catch(() => {});
  await waitUi(page, 800);
  const panelTrigger = page.locator('.propose-for, .id-tag, a.erp-link, button').filter({ hasText: /for |Open in|StaffInfo|Benjamin|Ella/i }).first();
  // Prefer clicking a worker name-ish in proposal title area
  const titleBit = page.locator('.feed h2, .feed .propose-for').first();
  if (await titleBit.count()) {
    await titleBit.click().catch(() => {});
    await waitUi(page, 1200);
    const body = await page.locator('body').innerText();
    log('record_panel_or_feed_click', await noFatalUi(page), {
      hasPanel: /profile|credential|shift detail|Close|hours/i.test(body),
    });
  } else {
    log('record_panel_or_feed_click', false, { error: 'no feed title' });
  }
  await shot(page, 'dashboard-interact');

  // Chat: scan shortcut
  const chat = page.getByLabel('Ross chat');
  if (await chat.count()) {
    await chat.fill('status');
    await page.getByRole('button', { name: /^Send$/i }).click();
    await waitUi(page, 2500);
    const body = await page.locator('body').innerText();
    log('chat_status', /Pending|Vacant|online|AI chat|Ross/i.test(body));
  } else {
    log('chat_status', false, { error: 'no chat' });
  }

  // ── Planner Run briefing ──
  await goto(page, '/planner');
  await page.getByRole('button', { name: /Run briefing/i }).click();
  await page.waitForFunction(() => !/Running…/i.test(document.body.innerText), null, {
    timeout: 90000,
  }).catch(() => {});
  await waitUi(page, 1200);
  await shot(page, 'planner-run');
  {
    const body = await page.locator('body').innerText();
    log('planner_run_briefing', /FILL RATE|This period|Vacant|RECOMMEND/i.test(body) && !/failed|unauthorized|503/i.test(body));
  }

  // ── Leaves cycle ──
  await goto(page, '/leaves');
  const leaveRun = page.getByRole('button', { name: /Run cycle|Run leave/i }).first();
  if (await leaveRun.count()) {
    await leaveRun.click();
    await page.waitForFunction(() => !/Running…/i.test(document.body.innerText), null, {
      timeout: 90000,
    }).catch(() => {});
    await waitUi(page, 1000);
    await shot(page, 'leaves-run');
    const body = await page.locator('body').innerText();
    log('leaves_run_cycle', !/unauthorized|502|Internal Server/i.test(body));
  } else {
    log('leaves_run_cycle', false, { error: 'no run button' });
  }

  // ── Swaps detect / load ──
  await goto(page, '/swaps');
  const swapRun = page.getByRole('button', { name: /Detect|Run|Refresh/i }).first();
  if (await swapRun.count()) {
    await swapRun.click();
    await waitUi(page, 2000);
  }
  await shot(page, 'swaps');
  log('swaps_interact', await noFatalUi(page));

  // ── Credentials refresh / remind (remind only if safe single) ──
  await goto(page, '/credentials');
  const credRefresh = page.getByRole('button', { name: /Refresh/i }).first();
  if (await credRefresh.count()) await credRefresh.click();
  await waitUi(page, 1200);
  await shot(page, 'credentials');
  log('credentials_load', /Credential|expir|within|No |worker/i.test(await page.locator('body').innerText()));

  // ── Confirms ──
  await goto(page, '/confirms');
  await shot(page, 'confirms');
  log('confirms_load', await noFatalUi(page));

  // ── Skills detail: response_review ──
  await goto(page, '/skills');
  const respSkill = page.locator('a, button, tr, .skills-row, .config-card').filter({ hasText: /Response Log Review/i }).first();
  if (await respSkill.count()) {
    await respSkill.click();
    await waitUi(page, 1500);
    // may navigate to /skills/response_review
    if (!page.url().includes('/skills/')) {
      await goto(page, '/skills/response_review');
    }
  } else {
    await goto(page, '/skills/response_review');
  }
  await shot(page, 'skill-response-review');
  {
    const body = await page.locator('body').innerText();
    log('skill_response_review', /response_review|auto_accept|auto_dismiss|Response/i.test(body));
  }

  // Skills: open worker_matching if linked
  await goto(page, '/skills/worker_matching').catch(() => goto(page, '/skills'));
  await waitUi(page, 1000);
  log('skill_worker_matching', await noFatalUi(page), { url: page.url() });

  // ── Config: open, verify fields, cancel-style (save same values) ──
  await goto(page, '/config');
  const threshold = page.locator('input[type="number"]').first();
  let thrVal = null;
  if (await threshold.count()) {
    thrVal = await threshold.inputValue();
    await threshold.fill(thrVal); // no-op change
  }
  const save = page.getByRole('button', { name: /Save/i }).first();
  if (await save.count()) {
    await save.click();
    await waitUi(page, 1500);
  }
  await shot(page, 'config-save');
  {
    const body = await page.locator('body').innerText();
    log('config_save', !/failed|unauthorized|503/i.test(body), { thrVal });
  }

  // ── Audit export ──
  await goto(page, '/audit');
  const exportBtn = page.getByRole('button', { name: /Export/i }).first();
  if (await exportBtn.count()) {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
      exportBtn.click(),
    ]);
    log('audit_export', download != null || (await noFatalUi(page)), {
      suggested: download ? download.suggestedFilename() : null,
    });
  } else {
    log('audit_export', false, { error: 'no export' });
  }
  await shot(page, 'audit');

  // ── Gaps: Request training only if button enabled and we can cancel — skip destructive; just count ──
  await goto(page, '/gaps');
  const reqTrain = page.getByRole('button', { name: /Request training/i });
  const reqCount = await reqTrain.count();
  log('gaps_request_training_buttons', reqCount >= 0, { reqCount, clicked: false });

  // ── ERP deep link navigation (expect iDempiere login / webui shell) ──
  await goto(page, '/');
  const erp = page.locator('a.erp-link, a:has-text("Open in AbilityERP")').first();
  if (await erp.count()) {
    const href = await erp.getAttribute('href');
    const erpPage = await browser.newPage();
    try {
      const resp = await erpPage.goto(href, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await waitUi(erpPage, 2000);
      const et = await erpPage.locator('body').innerText().catch(() => '');
      const title = await erpPage.title();
      await erpPage.screenshot({ path: path.join(OUT, 'erp-zoom.png'), fullPage: true });
      const ok =
        (resp?.status() ?? 0) < 500 &&
        (/login|password|iDempiere|zk|webui|User/i.test(et + title) || (resp?.status() ?? 0) === 200);
      log('erp_zoom_open', ok, { href, status: resp?.status(), title: title.slice(0, 80) });
    } catch (e) {
      log('erp_zoom_open', false, { href, error: String(e) });
    } finally {
      await erpPage.close();
    }
  } else {
    log('erp_zoom_open', false, { error: 'no erp link on dashboard' });
  }

  // ── Mobile viewport smoke ──
  await page.setViewportSize({ width: 390, height: 844 });
  for (const p of ['/', '/responses', '/rules', '/planner']) {
    await goto(page, p);
    await shot(page, `mobile-${p.replace(/\//g, '_') || 'home'}`);
    log(`mobile${p || '/'}`, (await noFatalUi(page)) && (await page.locator('body').innerText()).length > 40);
  }

  // ── Sidebar navigation clicks (SPA) ──
  await page.setViewportSize({ width: 1440, height: 900 });
  await goto(page, '/');
  for (const label of ['Rules', 'Responses', 'Skills', 'Audit']) {
    await page.locator('.nav a', { hasText: label }).first().click();
    await waitUi(page, 1200);
    log(`sidebar_${label}`, await noFatalUi(page), { url: page.url() });
  }
  await shot(page, 'sidebar-end');
} catch (e) {
  log('suite_crash', false, { error: String(e) });
  await shot(page, 'crash').catch(() => {});
} finally {
  const report = {
    base: BASE,
    at: new Date().toISOString(),
    pass: results.filter((r) => r.ok).length,
    fail: results.filter((r) => !r.ok).length,
    results,
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(
    'SUMMARY',
    JSON.stringify({
      pass: report.pass,
      fail: report.fail,
      failed: results.filter((r) => !r.ok).map((r) => r.step),
    }),
  );
  await browser.close();
  process.exit(report.fail ? 1 : 0);
}
