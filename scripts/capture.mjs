// Run on pilot, reusing its existing Playwright installation. No browser on the Mac.
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:3087';
if (process.env.LIVE_CAPTURE === '1') {
  let access = ''; for await (const chunk of process.stdin) access += chunk; access = access.trim();
  assert.ok(access, 'Provide studio access over stdin only.');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE, headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage(), errors = [], usage = [];
  const results = { baseURL, viewport: '1920x1080', mode: 'live', liveProviderTested: true, source: 'Owned original SVG artwork rasterized to PNG; no real person', vtoAttempts: 0 };
  page.on('pageerror', () => errors.push('Browser runtime error'));
  page.on('response', async response => {
    if (response.url().endsWith('/api/listing')) { const data = await response.json(); results.copyMode = data.mode; if (data.usage) usage.push(data.usage); }
    if (response.url().endsWith('/api/finish')) { const data = await response.json(); results.providerDeleted = data.deleted; }
  });
  await mkdir('media', { recursive: true });
  try {
    // Capture original neutral placeholders directly from our own vector assets.
    const asset = await context.newPage();
    await asset.goto(baseURL + '/assets/model-a.svg');
    const person = await asset.locator('svg').screenshot();
    await asset.goto(baseURL + '/assets/garment.svg');
    const garment = await asset.locator('svg').screenshot(); await asset.close();
    await page.goto(baseURL);
    await page.waitForFunction(() => document.querySelector('#mode').textContent.includes('Live'));
    await page.locator('#access-toggle').click(); await page.locator('#access').fill(access);
    await page.getByRole('button', { name: 'Use for this session' }).click(); access = '';
    for (const [id, buffer] of [['garment', garment], ['person', person]]) {
      await page.locator('#' + id).setInputFiles({ name: 'owned-placeholder.png', mimeType: 'image/png', buffer });
      await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Photo ready'));
    }
    await page.screenshot({ path: 'media/01-studio.png' });
    await page.locator('#seller-consent').check();
    results.vtoAttempts = 1;
    await page.locator('#generate').click();
    await page.waitForFunction(() => !document.querySelector('#generate').disabled, null, { timeout: 410000 });
    results.vtoWorked = await page.locator('#previews .look-badge').count() === 1;
    results.vtoStatus = await page.locator('#status').innerText();
    results.publishedUnits = await page.locator('#units').innerText();
    await page.locator('#studio').scrollIntoViewIfNeeded(); await page.screenshot({ path: 'media/02-collection.png' });
    await page.getByRole('button', { name: 'Shopper preview', exact: true }).click();
    await page.locator('#write-listing').click();
    await page.waitForFunction(() => !document.querySelector('#write-listing').disabled, null, { timeout: 55000 });
    await page.locator('#storefront').scrollIntoViewIfNeeded(); await page.screenshot({ path: 'media/03-storefront.png' });
    await page.locator('#shopper-form').scrollIntoViewIfNeeded(); await page.screenshot({ path: 'media/04-shopper-consent.png' });
    await page.getByRole('button', { name: 'Content kit', exact: true }).click();
    await page.evaluate(() => scrollTo(0, document.querySelector('#content').offsetTop - 24)); await page.screenshot({ path: 'media/05-content-kit.png' });
    results.copyNotice = await page.locator('#copy-mode').innerText();
    results.usage = usage; results.errors = errors;
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const phone = await mobile.newPage(); await phone.goto(baseURL); await phone.waitForFunction(() => document.querySelector('#mode').textContent.includes('Live'));
    await phone.screenshot({ path: 'media/06-mobile.png', fullPage: true }); await mobile.close();
    await writeFile('media/capture-results.json', JSON.stringify(results, null, 2) + '\n');
    console.log(JSON.stringify(results));
    assert.deepEqual(errors, []); assert.equal(results.copyMode, 'live');
  } finally { await context.close(); await browser.close(); }
  process.exit(0);
}
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
const failed = []; page.on('response', res => { if (res.status() >= 400) failed.push(`${res.status()} ${res.url()}`); });
await mkdir('media', { recursive: true });
try {
  await page.goto(baseURL); await page.waitForFunction(() => document.querySelector('#mode').textContent.includes('Demo'));
  await page.screenshot({ path: 'media/01-studio.png' });
  await page.locator('#generate').click();
  assert.equal(await page.locator('#generation-count').innerText(), '0 generations · this session');
  await page.locator('#seller-consent').check();
  await page.locator('#generate').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Demo collection ready'));
  assert.equal(await page.locator('#units').innerText(), '6');
  assert.equal(await page.locator('#previews article').count(), 3);
  await page.evaluate(() => scrollTo(0, document.querySelector('#studio').offsetTop - 24));
  await page.screenshot({ path: 'media/02-collection.png' });
  await page.getByRole('button', { name: 'Shopper preview', exact: true }).click();
  await page.locator('#write-listing').click();
  await page.waitForFunction(() => document.querySelector('#pdp-title').textContent === 'The Everyday Shirt' && !document.querySelector('#write-listing').disabled);
  await page.evaluate(() => scrollTo(0, document.querySelector('#storefront').offsetTop - 24));
  await page.screenshot({ path: 'media/03-storefront.png' });
  await page.locator('#shopper-consent').check();
  await page.locator('#shopper-submit').click();
  await page.waitForFunction(() => document.querySelector('#shopper-status').textContent.includes('Simulated illustration ready'));
  await page.locator('#shopper-form').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'media/04-shopper-consent.png' });
  await page.getByRole('button', { name: 'Content kit', exact: true }).click();
  await page.evaluate(() => scrollTo(0, 0));
  assert.match(await page.locator('#content-grid').innerText(), /needs info/);
  const download = page.waitForEvent('download'); await page.locator('#download').click();
  assert.equal((await download).suggestedFilename(), 'tryon-listing-content.json');
  await page.screenshot({ path: 'media/05-content-kit.png' });
  // An uploaded picture can be previewed locally, then invalidation and clear remove it.
  await page.getByRole('button', { name: 'Your studio', exact: true }).click();
  const image = await page.locator('#garment-image').screenshot();
  await page.locator('#garment').setInputFiles({ name: 'own-test.png', mimeType: 'image/png', buffer: image });
  await page.waitForFunction(() => document.querySelector('#garment-image').src.startsWith('data:'));
  assert.equal(await page.locator('#previews article').count(), 0, 'Changing a garment invalidates prior previews');
  assert.equal(await page.locator('#content-grid article').count(), 0);
  await page.locator('#clear').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Session photos and content cleared'));
  assert.ok(!(await page.locator('#garment-image').getAttribute('src')).startsWith('data:'));
  assert.equal(await page.locator('#garment').inputValue(), '');
  assert.equal(await page.locator('#seller-consent').isChecked(), false);
  // Personal data in the product name is rendered as text, never HTML.
  await page.locator('#product-name').fill('<img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: 'Content kit', exact: true }).click();
  await page.locator('#write-content').click();
  await page.waitForFunction(() => !document.querySelector('#write-content').disabled);
  assert.equal(await page.locator('#content-grid img').count(), 0);
  await page.locator('#clear').click();
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 });
  const phone = await mobile.newPage(); await phone.goto(baseURL);
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile layout must not overflow');
  await phone.screenshot({ path: 'media/06-mobile.png', fullPage: true });
  for (const name of ['Shopper preview', 'Content kit', 'Your studio']) { await phone.getByRole('button', { name, exact: true }).click(); assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); }
  await mobile.close();
  // Live UI contract uses intercepted API responses, never real provider credentials.
  const live = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const livePage = await live.newPage();
  let deletionAuthorized = false, liveCreateValidated = false;
  await live.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const body = request.method() === 'POST' ? request.postDataJSON() : {};
    let response;
    if (path === '/api/config') response = { mode: 'live', copyMode: 'demo' };
    else if (path === '/api/pricing') response = { units: 2 };
    else if (path === '/api/tryon') { liveCreateValidated = body.consent === true && body.person?.type === 'image/png' && body.garment?.type === 'image/png'; response = { token: 'mock-capability', mode: 'live', units: null }; }
    else if (path === '/api/poll') response = { provider: { data: { task_status: 'success' } } };
    else if (path === '/api/finish') response = { mode: 'live', image: 'data:image/png;base64,' + image.toString('base64'), deleted: false };
    else if (path === '/api/delete') { deletionAuthorized = request.headers()['x-studio-key'] === 'browser-test-access'; response = { deleted: true }; }
    else throw new Error('Unexpected mocked route ' + path);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
  });
  await livePage.goto(baseURL);
  await livePage.waitForFunction(() => document.querySelector('#mode').textContent.includes('Live'));
  await livePage.locator('#access-toggle').click(); await livePage.locator('#access').fill('browser-test-access');
  await livePage.getByRole('button', { name: 'Use for this session' }).click();
  const fullImage = await livePage.screenshot();
  for (const id of ['garment', 'person']) { await livePage.locator('#' + id).setInputFiles({ name: 'owned-photo.png', mimeType: 'image/png', buffer: fullImage }); await livePage.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Photo ready')); }
  await livePage.locator('#seller-consent').check(); await livePage.locator('#generate').click();
  await livePage.waitForFunction(() => !document.querySelector('#generate').disabled);
  assert.ok(liveCreateValidated); assert.ok(await livePage.locator('#cleanup').isVisible());
  await livePage.locator('#clear').click(); await livePage.waitForFunction(() => document.querySelector('#cleanup').hidden);
  assert.ok(deletionAuthorized, 'Clear must retain authorization only for its pending cleanup request');
  assert.equal(await livePage.locator('#person').inputValue(), '');
  assert.equal(await livePage.locator('#garment').inputValue(), '');
  await live.close();
  assert.deepEqual(errors, []); assert.deepEqual(failed, []);
  await writeFile('media/capture-results.json', JSON.stringify({ baseURL, viewport: '1920x1080', mobile: '390x844', mode: 'demo', checks: ['consent gate', 'three-model generation', 'session usage', 'product page generation', 'shopper try-on', 'content download', 'upload invalidation', 'photo clearing', 'escaped product text', 'mobile overflow', 'no page errors', 'no failed requests', 'mocked live photo consent', 'mocked live deletion retry and clear authorization'], result: 'pass', liveProviderTested: false }, null, 2) + '\n');
  console.log('Browser checks passed; 6 screenshots saved to media/.');
} finally { await context.close(); await browser.close(); }
