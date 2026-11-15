// SOS flood burst for k6: one request per virtual user, all VUs start together.
// Input: /scripts/.lt_jobs.json written by `load_test.py --prepare-out`.
// Output: /scripts/.lt_k6.json (summary) read by `load_test.py --report`.
import http from 'k6/http';
import { sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Trend } from 'k6/metrics';

const jobs = new SharedArray('jobs', () => JSON.parse(open('/scripts/.lt_jobs.json')).jobs);
const BASE = __ENV.BASE_URL || 'http://127.0.0.1:8100';
const GROUPS = ['bot_farm', 'botnet', 'citizens', 'panel', 'all'];
const CODES = [200, 201, 401, 429, 500];

const lat = {}, srv = {}, st = {};
for (const g of GROUPS) {
  lat[g] = new Trend(`lat_${g}`, true);
  srv[g] = new Trend(`srv_${g}`, true);
  for (const c of CODES) st[`${g}_${c}`] = new Counter(`st_${g}_${c}`);
}

export const options = {
  scenarios: { burst: { executor: 'per-vu-iterations', vus: jobs.length, iterations: 1, maxDuration: '120s' } },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
  discardResponseBodies: true,
};

export default function () {
  const j = __ENV.BASELINE ? { method: 'GET', path: '/health', headers: {}, group: 'panel', delay: 0 } : jobs[__VU - 1];
  if (j.delay) sleep(j.delay);
  const params = { headers: Object.assign({ 'Content-Type': 'application/json' }, j.headers) };
  const res = j.method === 'POST'
    ? http.post(BASE + j.path, JSON.stringify(j.body), params)
    : http.get(BASE + j.path, params);
  // client-observed: waiting for a socket + TCP connect + send + server + receive
  const total = res.timings.blocked + res.timings.connecting + res.timings.duration;
  const timing = res.headers['Server-Timing'] || '';
  const m = timing.match(/dur=([\d.]+)/);
  for (const g of [j.group, 'all']) {
    lat[g].add(total);
    if (m) srv[g].add(parseFloat(m[1]));
    if (st[`${g}_${res.status}`]) st[`${g}_${res.status}`].add(1);
  }
}

export function handleSummary(data) {
  return { '/scripts/.lt_k6.json': JSON.stringify(data) };
}
