import { timingSafeEqual } from 'node:crypto';
import { YouCamClient, readImage, demoTask, signTask, verifyTask, DEMO_UNITS_PER_IMAGE } from '../src/youcam.js';
import { generateListing } from '../src/listing.js';
const BODY_LIMIT = 4000000;
async function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { if (req.body.length > BODY_LIMIT) throw new Error('Upload is too large.'); return JSON.parse(req.body); }
  let size = 0, chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > BODY_LIMIT) throw new Error('Upload is too large.'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
function authorized(req, secret) {
  if (!secret) return false;
  const supplied = Buffer.from(req.headers['x-studio-key'] || '');
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
async function downloadResult(url, fetchImpl) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !(u.hostname.endsWith('.amazonaws.com') || u.hostname.endsWith('.makeupar.com'))) throw new Error('Unexpected result destination.');
  const res = await fetchImpl(u.href, { signal: AbortSignal.timeout(20000), redirect: 'error' });
  const type = res.headers.get('content-type')?.split(';')[0];
  if (!res.ok || !['image/jpeg', 'image/png'].includes(type)) throw new Error('Could not download the result image.');
  let size = 0, chunks = [];
  for await (const chunk of res.body) { size += chunk.length; if (size > 2900000) throw new Error('Result is too large for this prototype.'); chunks.push(chunk); }
  return `data:${type};base64,${Buffer.concat(chunks).toString('base64')}`;
}
export function createHandler({ env = process.env, fetchImpl = fetch } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, data) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
    try {
      const path = new URL(req.url, 'http://localhost').pathname.replace(/^\/api/, '');
      const live = Boolean(env.YOUCAM_API_KEY);
      if (path === '/config' && req.method === 'GET') return send(200, { mode: live ? 'live' : 'demo', copyMode: env.LLM_API_KEY ? 'live' : 'demo', requiresAccess: Boolean(live || env.LLM_API_KEY), maxImageBytes: 1400000 });
      if (req.method !== 'POST') return send(405, { error: 'Method not allowed.' });
      if ((live || env.LLM_API_KEY) && !authorized(req, env.STUDIO_ACCESS_TOKEN)) return send(401, { error: 'Enter the studio access code to use live services.' });
      const body = await bodyOf(req);
      if (path === '/listing') return send(200, await generateListing(body, { env, fetchImpl }));
      const client = new YouCamClient({ apiKey: env.YOUCAM_API_KEY, fetchImpl });
      const key = env.YOUCAM_API_KEY || 'tryon-listing-demo-signing-key';
      if (path === '/pricing') return send(200, { units: live ? await client.unitCost().catch(() => null) : DEMO_UNITS_PER_IMAGE });
      if (path === '/tryon') {
        if (body.consent !== true) return send(400, { error: 'Photo permission is required.' });
        const model = ['a', 'b', 'c'].includes(body.model) ? body.model : 'a';
        let raw, units;
        if (live) {
          const person = readImage(body.person), garment = readImage(body.garment);
          raw = await client.start({ person, garment });
          units = null; // Pricing is separate so a paid task token is returned immediately.
        } else { raw = demoTask(model); units = DEMO_UNITS_PER_IMAGE; }
        if (!raw.data.task_id) throw new Error('YouCam did not return a task ID.');
        return send(200, { mode: live ? 'live' : 'demo', provider: raw, token: signTask({ id: raw.data.task_id, model, mode: live ? 'live' : 'demo' }, key), units, unitsKind: live ? 'current published rate; not a billing receipt' : 'simulated units; no charge' });
      }
      if (['/poll', '/finish', '/delete'].includes(path)) {
        const task = verifyTask(body.token, key);
        if (task.mode !== (live ? 'live' : 'demo')) throw new Error('Task mode changed. Start again.');
        if (!live) {
          if (path === '/delete') return send(200, { deleted: true });
          return send(200, { mode: 'demo', provider: demoTask(task.model, true), ...(path === '/finish' ? { image: `/assets/model-${task.model}-tryon.svg`, deleted: true } : {}) });
        }
        if (path === '/delete') { await client.delete(task.id); return send(200, { deleted: true }); }
        const provider = await client.poll(task.id);
        if (provider.data.task_status === 'error') { let deleted = false; try { await client.delete(task.id); deleted = true; } catch {} return send(422, { deleted, error: 'YouCam could not process this image. Check that it contains one clearly visible person and one garment.' }); }
        if (path === '/poll' || provider.data.task_status !== 'success') return send(200, { mode: 'live', provider: { status: provider.status, data: { task_status: provider.data.task_status } } });
        let image;
        try { image = await downloadResult(provider.data.results?.url, fetchImpl); }
        catch (e) { await client.delete(task.id).catch(() => {}); throw e; }
        let deleted = false;
        try { await client.delete(task.id); deleted = true; } catch { /* Show retry control; never claim deletion succeeded. */ }
        return send(200, { mode: 'live', image, deleted });
      }
      return send(404, { error: 'Endpoint not found.' });
    } catch (e) {
      // Never return provider bodies, signed URLs, API keys or uploaded images in errors.
      let message = e.name === 'TimeoutError' ? 'Provider timed out. Try again later.' : e.message || 'Request failed.';
      for (const secret of [env.YOUCAM_API_KEY, env.LLM_API_KEY, env.STUDIO_ACCESS_TOKEN]) if (secret) message = message.split(secret).join('[redacted]');
      if (message.includes('https://') || message.length > 250) message = 'The provider request failed. Check your server configuration.';
      return send(400, { error: message });
    }
  };
}
export default createHandler();
