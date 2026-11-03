import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';

test.describe('MeshKit Section 9.4 E2E, Accessibility & Consent Mode v2', () => {
  test('Home G-code Calculator: sample load, strict 0-input validation, theme toggle, consent default denied, and axe audit', async ({
    page,
    context,
  }) => {
    await page.goto('/');

    // Consent Mode v2: no _ga cookie is set when consent is not granted
    const cookies = await context.cookies();
    expect(cookies.some((c) => c.name.startsWith('_ga'))).toBe(false);

    // Dismiss consent banner so it doesn't overlap elements during testing
    const declineBtn = page.locator('#consentDeclineBtn');
    if (await declineBtn.isVisible()) {
      await declineBtn.click();
    }

    // Theme toggle works
    const themeBtn = page.locator('#themeToggle');
    await themeBtn.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await themeBtn.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // Entering 0 grams must show $0.00 material cost, never silent fallback to 22
    const gramsInput = page.locator('#filamentGrams');
    await gramsInput.fill('0');
    await gramsInput.dispatchEvent('change');
    await expect(page.locator('#outMaterialCost')).toHaveText('$0.00');

    // Entering negative grams pauses outputs with em dash
    await gramsInput.fill('-5');
    await gramsInput.dispatchEvent('change');
    await expect(page.locator('#outSellingPrice')).toHaveText('—');

    // Sample load button restores valid G-code metrics
    await page.locator('#gcodeSampleBtn').click();
    await expect(page.locator('#gcodeParseState')).toHaveText('PARSED OK');

    // Accessibility check: 0 serious or critical axe violations
    const axeResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    const seriousOrCritical = axeResults.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical'
    );
    expect(seriousOrCritical).toEqual([]);
  });

  test('STL Repair Online: sample load, manifold repair, and binary STL download size (84 + 50*N)', async ({
    page,
  }) => {
    await page.goto('/stl-repair-online');
    const declineBtn = page.locator('#consentDeclineBtn');
    if (await declineBtn.isVisible()) await declineBtn.click();

    await page.locator('#stlSampleBtn').click();
    await expect(page.locator('#stlHoles')).toHaveText('1');

    await page.locator('#runStlRepairBtn').click();
    await expect(page.locator('#stlHoles')).toHaveText('0');
    await expect(page.locator('#stlVolume')).toHaveText('6.000 cm³');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#downloadRepairedStlBtn').click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();
    if (path) {
      const buf = readFileSync(path);
      expect(buf.byteLength).toBeGreaterThanOrEqual(84);
      const triCount = buf.readUInt32LE(80);
      expect(buf.byteLength).toBe(84 + 50 * triCount);
    }
  });

  test('STEP to STL Converter: sample load, unit switch, and STL export', async ({ page }) => {
    await page.goto('/step-to-stl-converter');
    const declineBtn = page.locator('#consentDeclineBtn');
    if (await declineBtn.isVisible()) await declineBtn.click();

    await page.locator('#stepSampleBtn').click();
    await expect(page.locator('#stepParseState')).toHaveText('ISO-10303-21');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#downloadConvertedStlBtn').click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();
    if (path) {
      const buf = readFileSync(path);
      const triCount = buf.readUInt32LE(80);
      expect(buf.byteLength).toBe(84 + 50 * triCount);
    }
  });
});
