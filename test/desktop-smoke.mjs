import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve(process.argv[2], 'package.json'));
const { chromium } = require('playwright-core');
const browser = await chromium.connectOverCDP(process.argv[3] ?? 'http://127.0.0.1:18743');
try {
  const page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url() === 'dsh-app://app/');
  assert.ok(page, 'Open the isolated DeepSeek Harness workspace before running the smoke test.');
  const timeout = 30_000;
  const closeSettings = page.getByRole('button', { name: 'Close', exact: true }).last();
  if (await closeSettings.isVisible()) await closeSettings.click();
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: /Settings/ }).first().click();
  await page.getByRole('button', { name: 'Models', exact: true }).click();
  const account = page.getByText(/fixture@example\.invalid.*Plan access.*Active/);
  const newConnection = page.getByRole('button', { name: /^(Continue with ChatGPT|Add ChatGPT account or workspace)$/ }).last();
  await account.or(newConnection).first().waitFor({ timeout });
  if (!await account.isVisible()) {
    await newConnection.click();
    await account.waitFor({ timeout });
  }
  console.log('DESKTOP_ACCOUNT_OK');
  await closeSettings.click();
  await page.getByRole('button', { name: 'New session', exact: true }).first().click();
  await page.getByRole('button', { name: /Select model, current/ }).click();
  await page.getByRole('menuitem', { name: /^Model/ }).click();
  await page.getByText('ChatGPT Desktop Fixture', { exact: true }).last().click();
  const editor = page.locator('[contenteditable=true]').last();
  await editor.fill('STREAM_DESKTOP_FIXTURE');
  await editor.press('Enter');
  await page.getByText('DESKTOP_STREAM_OK', { exact: true }).last().waitFor({ timeout });
  console.log('DESKTOP_STREAM_OK');
  await editor.fill('DELEGATE_DESKTOP_FIXTURE');
  await editor.press('Enter');
  await page.getByText('DESKTOP_DELEGATION_OK CODEX_FIXTURE_OK', { exact: true }).last().waitFor({ timeout });
  console.log('DESKTOP_DELEGATION_OK');
} finally {
  await browser.close();
}
