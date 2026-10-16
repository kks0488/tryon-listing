import test from 'node:test';
import assert from 'node:assert/strict';
import { YouCamClient, readImage, signTask, verifyTask, demoTask } from '../src/youcam.js';
const png = { type: 'image/png', data: Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64') };
const response = data => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
test('image validation rejects wrong MIME, signature and excessive payloads', () => {
  assert.equal(readImage(png).bytes.length, 9);
  assert.throws(() => readImage({ ...png, type: 'image/svg+xml' }));
  assert.throws(() => readImage({ ...png, data: Buffer.from('<svg>').toString('base64') }));
  assert.throws(() => readImage({ ...png, data: 'A'.repeat(2000000) }));
});
test('allocate, signed raw PUT, task create, polling and delete match YouCam schema', async () => {
  const calls = []; let count = 0;
  const client = new YouCamClient({ apiKey: 'test-credential', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/file')) { count++; return response({ status: 200, data: { files: [{ file_id: 'file-' + count, requests: [{ method: 'PUT', url: 'https://yce-us.s3-accelerate.amazonaws.com/signed', headers: { 'Content-Type': 'image/png', 'Content-Length': '9' } }] }] } }); }
    if (options.method === 'PUT') return new Response(null, { status: 200 });
    if (url.endsWith('/task/delete')) return response({ status: 200 });
    if (options.method === 'GET') return response({ status: 200, data: { task_status: 'success', error: null, results: { url: 'https://yce-us.s3-accelerate.amazonaws.com/result.png' } } });
    return response({ status: 200, data: { task_id: 'task-123' } });
  } });
  const start = await client.start({ person: readImage(png), garment: readImage(png) });
  assert.equal(start.data.task_id, 'task-123');
  assert.deepEqual(JSON.parse(calls[0].options.body), { files: [{ content_type: 'image/png', file_name: 'image.png', file_size: 9 }] });
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-credential');
  const put = calls.find(c => c.options.method === 'PUT');
  assert.equal(put.options.headers.Authorization, undefined);
  assert.ok(Buffer.isBuffer(put.options.body));
  assert.deepEqual(JSON.parse(calls[4].options.body), { src_file_id: 'file-1', ref_file_id: 'file-2', garment_category: 'upper_body', change_shoes: false, filter_multi_person: 'strict' });
  assert.equal((await client.poll('task-123')).data.task_status, 'success');
  await client.delete('task-123');
  assert.deepEqual(JSON.parse(calls[6].options.body), { task_id: 'task-123' });
});
test('provider failures never become successful generations', async () => {
  const client = new YouCamClient({ apiKey: 'x', fetchImpl: async () => new Response('{"status":401,"error_code":"InvalidAccessToken"}', { status: 401 }) });
  await assert.rejects(client.poll('t'), /InvalidAccessToken/);
});
test('signed task tokens reject tampering, different key and expired tasks', () => {
  const token = signTask({ id: 't', mode: 'live' }, 'key');
  assert.equal(verifyTask(token, 'key').id, 't');
  assert.throws(() => verifyTask(token + 'x', 'key'));
  assert.throws(() => verifyTask(token, 'other'));
  const now = Date.now; Date.now = () => now() + 25 * 60 * 60 * 1000;
  try { assert.throws(() => verifyTask(token, 'key'), /expired/); } finally { Date.now = now; }
});
test('demo fixtures preserve create and polling response shapes', () => {
  assert.deepEqual(demoTask('b'), { status: 200, data: { task_id: 'demo-b' } });
  assert.deepEqual(demoTask('b', true), { status: 200, data: { task_status: 'success', error: null, results: { url: '/assets/model-b-tryon.svg' } } });
});
test('signed upload destinations cannot redirect to arbitrary servers', async () => {
  const client = new YouCamClient({ apiKey: 'x', fetchImpl: async () => response({ status: 200, data: { files: [{ file_id: 'x', requests: [{ method: 'PUT', url: 'https://evil.example/upload', headers: {} }] }] } }) });
  await assert.rejects(client.upload(readImage(png)), /Unexpected upload/);
});
test('feature pricing follows official pagination and normalizes per-image unit cost', async () => {
  const urls = [];
  const client = new YouCamClient({ apiKey: 'x', fetchImpl: async url => {
    urls.push(url);
    return response(urls.length === 1 ? { result: { skus: [], next_token: 'page two' } } : { result: { skus: [{ run_task_url: '/s2s/v2.0/task/cloth-v4', unit: 'result_image', amount: 6, proc_unit: 3 }] } });
  } });
  assert.equal(await client.unitCost(), 2);
  assert.match(urls[0], /page_size=20/);
  assert.match(urls[1], /starting_token=page%20two/);
});
