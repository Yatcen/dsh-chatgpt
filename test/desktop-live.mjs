import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve(process.argv[2], 'package.json'));
const { chromium } = require('playwright-core');
const browser = await chromium.connectOverCDP(process.argv[3] ?? 'http://127.0.0.1:18743');
try {
  const page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url() === 'dsh-app://app/');
  assert.ok(page, 'Open the isolated DeepSeek Harness workspace before running the live test.');
  const ready = page.getByText(/Plan access.*Active/);
  await ready.waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await page.getByRole('button', { name: 'New session', exact: true }).first().click();
  await page.getByRole('button', { name: /Select model, current/ }).click();
  await page.getByRole('menuitem', { name: /^Model/ }).click();
  const model = page.locator('[data-provider-id="dsh-chatgpt"][data-model-id]').last();
  await model.click({ timeout: 20_000 });
  const editor = page.locator('[contenteditable=true]').last();
  await editor.fill('Reply with exactly DSH_LIVE_MAIN_OK.');
  await editor.press('Enter');
  await page.getByText('DSH_LIVE_MAIN_OK', { exact: true }).last().waitFor({ timeout: 90_000 });
  console.log('DSH_LIVE_MAIN_OK');
  await editor.fill('Use subagent_dsh_chatgpt to delegate this read-only text task: Reply with exactly DSH_LIVE_CODEX_OK. Wait for the child result, then repeat exactly what it returned.');
  await editor.press('Enter');
  await page.getByText('DSH_LIVE_CODEX_OK', { exact: true }).last().waitFor({ timeout: 180_000 });
  console.log('DSH_LIVE_CODEX_OK');
} finally {
  await browser.close();
}
