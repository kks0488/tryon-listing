import { createHmac, timingSafeEqual } from 'node:crypto';
export const API_BASE = 'https://yce-api-01.makeupar.com/s2s/v2.0';
export const DEMO_UNITS_PER_IMAGE = 2; // Scenario fixture only; V4 live pricing is queried separately.
export const MAX_IMAGE_BYTES = 1400000;
export function readImage(raw) {
  if (!raw || !['image/jpeg', 'image/png'].includes(raw.type) || typeof raw.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw.data)) throw new Error('Upload a JPEG or PNG image.');
  if (raw.data.length > MAX_IMAGE_BYTES * 1.34) throw new Error('Each image must be under 1.4 MB.');
  const bytes = Buffer.from(raw.data, 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Each image must be under 1.4 MB.');
  const valid = raw.type === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!valid) throw new Error('Image contents do not match the selected format.');
  return { bytes, type: raw.type, name: raw.type === 'image/png' ? 'image.png' : 'image.jpg' };
}
export class YouCamClient {
  constructor({ apiKey, fetchImpl = fetch }) { this.key = apiKey; this.fetch = fetchImpl; }
  async request(path, body) {
    const res = await this.fetch(API_BASE + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000), redirect: 'error' });
    const json = await res.json();
    if (!res.ok || (json.status && json.status !== 200)) throw new Error(`YouCam request failed (${res.status}): ${json.error_code || 'provider error'}.`);
    if (!json.data && path !== '/task/delete') throw new Error('YouCam returned an invalid response.');
    return json;
  }
  async upload(image) {
    const content_type = image.type === 'image/jpeg' ? 'image/jpg' : image.type;
    const json = await this.request('/file', { files: [{ content_type, file_name: image.name, file_size: image.bytes.length }] });
    const file = json.data.files?.[0];
    if (!file?.file_id || !file.requests?.length) throw new Error('YouCam did not provide an upload URL.');
    for (const req of file.requests) {
      const url = new URL(req.url);
      // Trust only HTTPS storage URLs returned by the authenticated provider.
      if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname.endsWith('.amazonaws.com') || url.hostname.endsWith('.makeupar.com'))) throw new Error('Unexpected upload destination.');
      if (req.method !== 'PUT') throw new Error('Unsupported upload method.');
      const res = await this.fetch(url.href, { method: req.method, headers: req.headers, body: image.bytes, signal: AbortSignal.timeout(10000), redirect: 'error' });
      if (!res.ok) throw new Error(`YouCam image upload failed (${res.status}).`);
    }
    return file.file_id;
  }
  async start({ person, garment }) {
    const [src_file_id, ref_file_id] = await Promise.all([this.upload(person), this.upload(garment)]);
    return this.request('/task/cloth-v4', { src_file_id, ref_file_id, garment_category: 'upper_body', change_shoes: false, filter_multi_person: 'strict' });
  }
  async delete(id) {
    try { return await this.request('/task/delete', { task_id: id }); }
    catch (error) { if (/InvalidTaskId/.test(error.message)) return { status: 200 }; throw error; }
  }
  async unitCost() {
    let next;
    for (let page = 0; page < 10; page++) {
      const res = await this.fetch(API_BASE + '/credit/feature-cost?page_size=20' + (next ? '&starting_token=' + encodeURIComponent(next) : ''), { headers: { Authorization: `Bearer ${this.key}` }, signal: AbortSignal.timeout(3000), redirect: 'error' });
      if (!res.ok) return null;
      const json = await res.json();
      const result = json.result || json.data?.result || json.data;
      const sku = result?.skus?.find(s => s.run_task_url?.endsWith('/task/cloth-v4'));
      if (sku?.unit === 'result_image' && Number.isFinite(Number(sku.amount)) && Number(sku.proc_unit) > 0) return Number(sku.amount) / Number(sku.proc_unit);
      next = result?.next_token;
      if (!next) return null;
    }
    return null;
  }
  poll(id) { return this.request(`/task/cloth-v4/${encodeURIComponent(id)}`); }
}
export function signTask(payload, key) {
  const data = Buffer.from(JSON.stringify({ ...payload, expires: Date.now() + 24 * 60 * 60 * 1000 })).toString('base64url');
  return `${data}.${createHmac('sha256', key).update(data).digest('base64url')}`;
}
export function verifyTask(token, key) {
  if (typeof token !== 'string' || token.length > 3000) throw new Error('Invalid task token.');
  const [data, signature, extra] = token.split('.');
  const expected = createHmac('sha256', key).update(data || '').digest();
  const actual = Buffer.from(signature || '', 'base64url');
  if (extra || expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('Invalid task token.');
  const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
  if (!payload.id || payload.expires < Date.now()) throw new Error('Task expired. Start a new generation.');
  return payload;
}
export function demoTask(id, ready = false) {
  return ready ? { status: 200, data: { error: null, results: { url: `/assets/model-${id}-tryon.svg` }, task_status: 'success' } }
    : { status: 200, data: { task_id: `demo-${id}` } };
}
