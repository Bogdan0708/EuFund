/**
 * k6 Load Test - EU Funds Platform
 * Simulates Romanian user patterns
 *
 * Run: k6 run performance/load-test.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const apiLatency = new Trend('api_latency', true);

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  stages: [
    { duration: '2m', target: 50 },    // Ramp up
    { duration: '5m', target: 200 },   // Normal load
    { duration: '3m', target: 500 },   // Peak load
    { duration: '5m', target: 1000 },  // Stress test
    { duration: '2m', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<2000'], // <500ms p95, <2s p99
    errors: ['rate<0.05'],                           // <5% error rate
    api_latency: ['p(95)<500'],
  },
};

// Simulate typical Romanian user journey
export default function () {
  const scenario = Math.random();

  if (scenario < 0.4) {
    browsePublicPages();
  } else if (scenario < 0.7) {
    checkOrganization();
  } else if (scenario < 0.9) {
    viewDashboard();
  } else {
    apiHealthCheck();
  }

  sleep(Math.random() * 3 + 1); // 1-4s think time
}

function browsePublicPages() {
  // Homepage
  let res = http.get(`${BASE_URL}/`);
  check(res, { 'homepage 200': (r) => r.status === 200 });
  errorRate.add(res.status !== 200);
  apiLatency.add(res.timings.duration);

  sleep(1);

  // Funding programs page
  res = http.get(`${BASE_URL}/ro/programs`);
  check(res, { 'programs page 200': (r) => r.status === 200 });
  errorRate.add(res.status !== 200);

  sleep(2);

  // Switch language
  res = http.get(`${BASE_URL}/en/programs`);
  check(res, { 'english page 200': (r) => r.status === 200 });
  errorRate.add(res.status !== 200);
}

function checkOrganization() {
  // ONRC lookup (cached)
  const cuis = ['12345678', '87654321', '11111111', '22222222'];
  const cui = cuis[Math.floor(Math.random() * cuis.length)];

  const res = http.get(`${BASE_URL}/api/organizations/check/${cui}`);
  check(res, {
    'org check status ok': (r) => r.status === 200 || r.status === 404,
  });
  apiLatency.add(res.timings.duration);
  errorRate.add(res.status >= 500);
}

function viewDashboard() {
  // Simulated authenticated request
  const headers = { Authorization: 'Bearer test-token' };

  let res = http.get(`${BASE_URL}/api/dashboard/stats`, { headers });
  check(res, { 'dashboard stats': (r) => r.status === 200 || r.status === 401 });
  apiLatency.add(res.timings.duration);

  sleep(1);

  res = http.get(`${BASE_URL}/api/proposals`, { headers });
  check(res, { 'proposals list': (r) => r.status === 200 || r.status === 401 });
  apiLatency.add(res.timings.duration);
}

function apiHealthCheck() {
  const res = http.get(`${BASE_URL}/api/health`);
  check(res, {
    'health check 200': (r) => r.status === 200,
    'health check fast': (r) => r.timings.duration < 200,
  });
  apiLatency.add(res.timings.duration);
  errorRate.add(res.status !== 200);
}
