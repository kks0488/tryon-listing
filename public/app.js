const $ = id => document.getElementById(id);
let config = { mode: 'demo', copyMode: 'demo' }, access = '', garment = null, person = null, shopper = null, bundle = null, generation = 0, units = 0, unknownUnits = false, busy = false;
let images = [], tokens = new Set(), epoch = 0;
const photoVersion = { garment: 0, person: 0, 'shopper-photo': 0 };
function invalidate() {
  images = []; bundle = null; $('previews').innerHTML = '<p class="hint">Product changed. Create a new collection for these details.</p>';
  $('shop-image').src = garment?.url || '/assets/garment.svg'; $('shop-image-label').textContent = 'GARMENT PHOTO · NO TRY-ON YET';
  $('pdp-title').textContent = $('product-name').value; $('pdp-subtitle').textContent = 'Product page needs regeneration.'; $('pdp-description').textContent = $('facts').value; $('faq').replaceChildren(); $('content-grid').replaceChildren();
}
for (const id of ['product-name', 'facts']) $(id).addEventListener('input', () => { if (!busy) invalidate(); });
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names = { a: 'Alex', b: 'Jordan', c: 'Sam', own: 'Your model' };
const silhouettes = { a: 'Straight silhouette', b: 'Fuller silhouette', c: 'Narrow silhouette', own: 'Uploaded photo' };
async function api(path, body, accessCode = access) {
  const res = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(accessCode ? { 'x-studio-key': accessCode } : {}) }, body: JSON.stringify(body) });
  const json = await res.json(); if (!res.ok) { const error = new Error(json.error || 'Request failed.'); error.deleted = json.deleted; throw error; } return json;
}
function tab(id) { document.querySelectorAll('.tab-panel').forEach(el => el.hidden = el.id !== id); document.querySelectorAll('.nav').forEach(el => { el.classList.toggle('active', el.dataset.tab === id); el.setAttribute('aria-current', el.dataset.tab === id ? 'page' : 'false'); }); }
document.querySelectorAll('[data-tab]').forEach(el => el.addEventListener('click', () => tab(el.dataset.tab)));
function status(id, message, error = false) { $(id).textContent = message; $(id).classList.toggle('error', error); }
function locked(value) { busy = value; for (const id of ['generate', 'shopper-submit', 'write-content', 'write-listing', 'clear', 'garment', 'person', 'shopper-photo', 'product-name', 'facts']) $(id).disabled = value; }
async function loadPhoto(file) {
  if (!file) return null;
  if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 1400000 || !file.size) throw new Error('Choose a JPEG or PNG under 1.4 MB.');
  const url = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('Could not read this photo.')); r.readAsDataURL(file); });
  const img = new Image(); img.src = url; await img.decode().catch(() => { throw new Error('This file is not a readable image.'); });
  if (config.mode === 'live' && (Math.min(img.width, img.height) < 384 || Math.max(img.width, img.height) < 512 || Math.max(img.width, img.height) > 4096)) throw new Error('Live images need at least 512 × 384 pixels and a maximum side of 4096 pixels.');
  return { type: file.type, data: url.split(',')[1], url };
}
for (const id of ['garment', 'person', 'shopper-photo']) $(id).addEventListener('change', async () => {
  const version = ++photoVersion[id], photoEpoch = epoch;
  try {
    const photo = await loadPhoto($(id).files[0]);
    if (version !== photoVersion[id] || photoEpoch !== epoch) return;
    if (id === 'garment') { garment = photo; $('garment-image').src = photo?.url || '/assets/garment.svg'; $('garment-image').alt = photo ? 'Your uploaded garment' : 'Original garment illustration'; }
    else if (id === 'person') person = photo; else shopper = photo;
    if (id === 'garment' || id === 'person') invalidate();
    status(id === 'shopper-photo' ? 'shopper-status' : 'status', photo ? 'Photo ready. It stays in memory until you generate or clear this session.' : 'Photo removed.');
  } catch (error) { if (version !== photoVersion[id] || photoEpoch !== epoch) return; $(id).value = ''; if (id === 'garment') { garment = null; $('garment-image').src = '/assets/garment.svg'; } else if (id === 'person') person = null; else shopper = null; if (id === 'garment' || id === 'person') invalidate(); status(id === 'shopper-photo' ? 'shopper-status' : 'status', error.message, true); }
});
$('access-toggle').onclick = () => { $('access-panel').hidden = !$('access-panel').hidden; if (!$('access-panel').hidden) $('access').focus(); };
$('access-panel').onsubmit = e => { e.preventDefault(); access = $('access').value; $('access').value = ''; $('access-panel').hidden = true; status('status', 'Access code saved in memory for this session.'); };
function showCleanup() { $('cleanup').hidden = tokens.size === 0; status('cleanup-status', `${tokens.size} task(s) still need provider deletion. Running tasks can only be deleted after they finish. Keep this page open and retry.`); }
async function cleanup(accessCode = access) { for (const token of [...tokens]) { try { await api('delete', { token }, accessCode); tokens.delete(token); } catch { /* Retain token for explicit retry. */ } } showCleanup(); }
$('retry-cleanup').onclick = () => cleanup();
async function tryon(model, photo, target, consent) {
  const ownEpoch = epoch;
  const pricing = config.mode === 'live' ? await api('pricing', {}).catch(() => ({ units: null })) : null;
  const start = await api('tryon', { model, person: photo && { type: photo.type, data: photo.data }, garment: garment && { type: garment.type, data: garment.data }, consent });
  tokens.add(start.token);
  if (pricing) start.units = pricing.units;
  generation++; if (start.units === null) unknownUnits = true; else units += start.units;
  $('units').textContent = unknownUnits ? `${units || '—'} + ?` : String(units);
  $('unit-label').textContent = start.mode === 'demo' ? 'simulated units used' : 'units at published rate';
  $('generation-count').textContent = `${generation} generations · this session`;
  const delay = start.mode === 'demo' ? 700 : 10000;
  for (let attempt = 0; attempt < (start.mode === 'demo' ? 1 : 36); attempt++) {
    await new Promise(r => setTimeout(r, delay));
    if (ownEpoch !== epoch) throw new Error('Session cleared.');
    status(target, start.mode === 'demo' ? 'Preparing your illustrated demo preview…' : `YouCam is styling your photo… ${attempt + 1}/36`);
    let poll;
    try { poll = await api('poll', { token: start.token }); }
    catch (error) { if (error.deleted) tokens.delete(start.token); throw error; }
    if (poll.provider.data.task_status === 'success') {
      const result = await api('finish', { token: start.token });
      if (!result.image) throw new Error('Result was not ready. Please retry.');
      if (result.deleted) tokens.delete(start.token); showCleanup();
      return { src: result.image, model, mode: start.mode, label: start.mode === 'demo' ? 'SIMULATED · ILLUSTRATION' : 'YOUCAM TRY-ON' };
    }
  }
  throw new Error('This task is taking longer than expected. Retry provider deletion after it completes.');
}
function renderPreviews() {
  $('previews').innerHTML = images.map((image, i) => `<article class="look"><div class="look-image"><img src="${escape(image.src)}" alt="${escape(image.mode)} preview on ${escape(names[image.model])}"><span class="look-badge">${image.label}</span></div><div class="look-caption"><strong>${names[image.model]}</strong><span>0${i + 1} / ${silhouettes[image.model]}</span></div></article>`).join('');
  if (images[0]) { $('shop-image').src = images[0].src; $('shop-image-label').textContent = images[0].label; }
}
$('studio-form').onsubmit = async e => {
  e.preventDefault(); if (busy) return;
  const models = person ? ['own'] : [...document.querySelectorAll('input[name=model]:checked')].map(el => el.value);
  if (!models.length) return status('status', 'Choose at least one model or upload a photo you own.', true);
  if (config.mode === 'live' && (!garment || !person)) return status('status', 'Live mode needs your garment photo and a model photo you have permission to use.', true);
  if (!$('seller-consent').checked) return status('status', 'Please give photo permission first.', true);
  locked(true); images = []; $('previews').replaceChildren(); $('collection-name').textContent = $('product-name').value;
  try {
    for (let i = 0; i < models.length; i++) {
      status('status', `Creating perspective ${i + 1} of ${models.length}…`);
      const result = await tryon(models[i] === 'own' ? 'a' : models[i], person, 'status', true);
      if (models[i] === 'own' && config.mode === 'live') result.model = 'own';
      images.push(result); renderPreviews();
    }
    status('status', config.mode === 'demo' ? 'Demo collection ready. Illustrations do not reproduce uploaded garment details. No AI inference or charges.' : 'Collection ready. Completed tasks were downloaded; see any pending deletion notice below.');
  } catch (error) { status('status', error.message, true); showCleanup(); }
  finally { locked(false); }
};
$('shopper-form').onsubmit = async e => {
  e.preventDefault(); if (busy) return;
  if (!$('shopper-consent').checked) return status('shopper-status', 'Photo permission is required.', true);
  if (config.mode === 'live' && (!garment || !shopper)) return status('shopper-status', 'Upload your photo and ask the seller to add a garment photo in the studio first.', true);
  locked(true);
  try { const result = await tryon('a', shopper, 'shopper-status', true); $('shop-image').src = result.src; $('shop-image-label').textContent = result.label; status('shopper-status', config.mode === 'demo' ? 'Simulated illustration ready. Your photo was not processed or sent to YouCam.' : 'Preview ready. This visual result does not predict physical fit.'); }
  catch (error) { status('shopper-status', error.message, true); showCleanup(); }
  finally { locked(false); }
};
function renderContent() {
  const b = bundle;
  $('pdp-title').textContent = b.pdp.headline; $('pdp-subtitle').textContent = b.pdp.subheadline; $('pdp-description').textContent = b.pdp.description.join(' ');
  $('faq').innerHTML = b.pdp.faq.map(q => `<details><summary>${escape(q.question)}</summary><p>${escape(q.answer)}</p></details>`).join('');
  $('content-grid').innerHTML = `<article class="panel content-card"><span class="eyebrow">01 / PRODUCT STORY</span><h3>${escape(b.pdp.headline)}</h3>${b.pdp.description.map(p => `<p>${escape(p)}</p>`).join('')}<h4>Fit notes & questions</h4>${b.pdp.faq.map(q => `<p><strong>${escape(q.question)}</strong><br>${escape(q.answer)}</p>`).join('')}</article><article class="panel content-card"><span class="eyebrow">02 / CAMPAIGN COPY</span><h3>Ready for your next launch.</h3>${b.ads.headlines.map(p => `<h4>${escape(p)}</h4>`).join('')}${b.ads.bodies.map(p => `<p>${escape(p)}</p>`).join('')}<h4>Before you publish</h4>${b.listingCheck.map(p => `<p><strong>${escape(p.issue)}</strong><br>${escape(p.fix)}</p>`).join('')}</article><article class="panel content-card"><span class="eyebrow">03 / SHORTS SCRIPT</span><h3>${escape(b.shorts.hook)}</h3>${b.shorts.scenes.map(s => `<h4>${escape(s.time)} · ${escape(s.caption)}</h4><p>${escape(s.visual)}</p><p>Voiceover: ${escape(s.voiceover)}</p>`).join('')}<p>${escape(b.shorts.cta)}</p></article>`;
}
async function write(target) {
  if (busy) return; locked(true); status('content-status', 'Writing from your confirmed product facts…'); status('status', 'Preparing your content kit…');
  try { const result = await api('listing', { name: $('product-name').value, facts: $('facts').value }); bundle = result.bundle; renderContent(); $('copy-mode').textContent = `${result.mode === 'demo' ? 'Deterministic demo copy · no LLM call' : 'Live LLM copy · check every claim'} · seller review required`; status('content-status', 'Content kit ready for review. Verify all product claims before publishing.'); status('status', 'Product page and content kit ready for review.'); tab(target); }
  catch (error) { status('content-status', error.message, true); status('status', error.message, true); }
  finally { locked(false); }
}
$('write-listing').onclick = () => write('storefront'); $('write-content').onclick = () => write('content');
$('download').onclick = () => {
  if (!bundle) return status('content-status', 'Generate your content kit first.', true);
  const url = URL.createObjectURL(new Blob([JSON.stringify({ disclosure: 'Seller review required. Visual try-on does not predict physical fit.', copyMode: config.copyMode, ...bundle }, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'tryon-listing-content.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('clear').onclick = async () => {
  if (busy) return; const cleanupAccess = access; epoch++; garment = person = shopper = bundle = null; images = []; access = ''; generation = units = 0; unknownUnits = false;
  for (const id of ['garment', 'person', 'shopper-photo', 'access']) $(id).value = '';
  $('seller-consent').checked = $('shopper-consent').checked = false;
  $('garment-image').src = '/assets/garment.svg'; $('shop-image').src = '/assets/model-a-tryon.svg'; $('shop-image-label').textContent = 'ILLUSTRATED DEMO';
  $('units').textContent = '0'; $('generation-count').textContent = '0 generations · this session';
  $('previews').innerHTML = '<p>Your session photos have been cleared. Create a new collection to preview it here.</p>';
  $('content-grid').replaceChildren(); $('pdp-title').textContent = 'Your next product'; $('pdp-subtitle').textContent = ''; $('pdp-description').textContent = ''; $('faq').replaceChildren();
  status('status', tokens.size ? 'Local photos cleared. Some provider tasks still need deletion; enter your access code and retry.' : 'Session photos and content cleared.'); status('shopper-status', 'Session photos cleared.'); status('content-status', 'Session content cleared.');
  await cleanup(cleanupAccess);
};
try {
  const res = await fetch('/api/config'); if (!res.ok) throw new Error(); config = await res.json();
  $('mode').textContent = config.mode === 'live' ? '● Live YouCam studio' : '● Demo studio';
  $('demo-notice').textContent = config.mode === 'live' ? 'LIVE MODE' : 'DEMO MODE';
  if (config.mode === 'live') { $('mode-detail').textContent = 'Your own photos are sent to YouCam with permission. Access code required. Live generations consume provider units.'; $('shopper-status').textContent = 'Upload a photo you own and give permission before generating.'; }
} catch { status('status', 'Could not connect to the server. Reload to try again.', true); $('generate').disabled = true; }
