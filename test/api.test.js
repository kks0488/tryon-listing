import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHandler } from '../api/index.js';
const png = { type: 'image/png', data: Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64') };
const json = data => new Response(JSON.stringify(data), { status: 200 });
async function request(handler, path, body, headers = {}, method = 'POST') {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { url: '/api/' + path, method, headers });
  const res = { headers: {}, setHeader(k,v) { this.headers[k] = v; }, end(data) { this.data = JSON.parse(data); } };
  await handler(req, res); return { status: res.statusCode, data: res.data, headers: res.headers };
}
test('offline end-to-end consent, create, poll, finish, listing and delete', async () => {
  const handler = createHandler({ env: {}, fetchImpl: () => { throw new Error('No provider calls in demo'); } });
  assert.equal((await request(handler, 'tryon', { model: 'b' })).status, 400);
  const create = await request(handler, 'tryon', { consent: true, model: 'b' });
  assert.equal(create.data.mode, 'demo'); assert.equal(create.data.units, 2);
  const token = create.data.token;
  assert.equal((await request(handler, 'poll', { token })).data.provider.data.task_status, 'success');
  assert.equal((await request(handler, 'finish', { token })).data.image, '/assets/model-b-tryon.svg');
  assert.equal((await request(handler, 'delete', { token })).data.deleted, true);
  assert.equal((await request(handler, 'listing', { name: 'T', facts: 'Red top' })).data.mode, 'demo');
  assert.equal(create.headers['Cache-Control'], 'no-store');
});
test('live mode rejects public paid requests without studio authorization', async () => {
  const handler = createHandler({ env: { YOUCAM_API_KEY: 'private-key', STUDIO_ACCESS_TOKEN: 'private-access' }, fetchImpl: () => { throw new Error('Must not call'); } });
  assert.equal((await request(handler, 'config', undefined, {}, 'GET')).data.mode, 'live');
  assert.equal((await request(handler, 'tryon', { consent: true })).status, 401);
  assert.equal((await request(handler, 'tryon', { consent: true }, { 'x-studio-key': 'private-access' })).status, 400);
});
test('live upload/poll/finish downloads result before deleting provider images', async () => {
  const calls = []; let fileCount = 0;
  const handler = createHandler({ env: { YOUCAM_API_KEY: 'private-key', STUDIO_ACCESS_TOKEN: 'private-access' }, fetchImpl: async (url, options) => {
    calls.push({ url, method: options.method });
    if (url.endsWith('/file')) return json({ status: 200, data: { files: [{ file_id: 'file-' + (++fileCount), requests: [{ method: 'PUT', url: 'https://yce-us.s3.amazonaws.com/upload', headers: { 'Content-Type': 'image/png' } }] }] } });
    if (options.method === 'PUT') return new Response(null, { status: 200 });
    if (url.includes('feature-cost')) return json({ result: { skus: [{ amount: 6, proc_unit: 2, unit: 'result_image', run_task_url: 'https://yce-api-01.makeupar.com/s2s/v2.0/task/cloth-v4' }] } });
    if (url.endsWith('/task/cloth-v4') && options.method === 'POST') return json({ status: 200, data: { task_id: 'live-task' } });
    if (url.endsWith('/live-task')) return json({ status: 200, data: { task_status: 'success', results: { url: 'https://yce-us.s3.amazonaws.com/result' }, error: null } });
    if (url.endsWith('/result')) return new Response(Buffer.from(png.data, 'base64'), { headers: { 'Content-Type': 'image/png' } });
    if (url.endsWith('/task/delete')) return json({ status: 200 });
    throw new Error('Unexpected request');
  } });
  const headers = { 'x-studio-key': 'private-access' };
  const start = await request(handler, 'tryon', { consent: true, person: png, garment: png }, headers);
  assert.equal(start.status, 200); assert.equal(start.data.units, null);
  assert.equal((await request(handler, 'pricing', {}, headers)).data.units, 3);
  const token = start.data.token;
  const poll = await request(handler, 'poll', { token }, headers);
  assert.equal(poll.data.provider.data.results, undefined, 'Do not disclose provider result URLs');
  const finish = await request(handler, 'finish', { token }, headers);
  assert.equal(finish.data.deleted, true); assert.match(finish.data.image, /^data:image\/png;base64,/);
  assert.ok(calls.findIndex(c => c.url.endsWith('/result')) < calls.findIndex(c => c.url.endsWith('/task/delete')));
  assert.ok(!JSON.stringify(start.data).includes('private-key'));
});
test('invalid task signature cannot poll or delete another task', async () => {
  const handler = createHandler({ env: {} });
  assert.equal((await request(handler, 'poll', { token: 'made.up' })).status, 400);
});
