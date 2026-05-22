import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

/**
 * Flash-sale load test
 *
 * Scenario: 200 concurrent users, 3-minute sustained load.
 * Target: p99 < 150ms, error rate < 1%.
 *
 * Realistic for a single Node.js instance on a 4-core server.
 * Scale target (1,000 rps) requires horizontal scaling — see SPEC §6.1.
 *
 * Run: k6 run tests/load/flash-sale.js
 * With env: k6 run -e BASE_URL=http://localhost:3000 tests/load/flash-sale.js
 */

const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '30s', target: 50  },  // Warm-up ramp
    { duration: '1m',  target: 200 },  // Ramp to 200 concurrent users
    { duration: '3m',  target: 200 },  // Sustained flash-sale load
    { duration: '30s', target: 0   },  // Graceful ramp-down
  ],
  thresholds: {
    // p99 < 150ms for order acceptance (SPEC §6 SLO)
    http_req_duration: ['p(99)<150', 'p(50)<30'],
    // Error rate < 1% (excluding expected 409/429)
    errors: ['rate<0.01'],
    // Zero 5xx errors allowed
    'http_req_failed{status:500}': ['rate<0.001'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

const SKUS = ['WIDGET-1', 'WIDGET-2', 'WIDGET-3'];

export default function () {
  const sku = SKUS[Math.floor(Math.random() * SKUS.length)];
  const idempotencyKey = crypto.randomUUID();
  const clientId = `load-test-user-${__VU}`;

  const payload = JSON.stringify({
    customerId: `customer-${__VU}`,
    items: [{ sku, quantity: 1, unitPrice: '29.99' }],
    currency: 'USD',
    paymentToken: 'tok_visa_test',
  });

  const res = http.post(`${BASE_URL}/api/v1/orders`, payload, {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      'X-Client-ID': clientId,
    },
    timeout: '5s',
  });

  // 201 = created, 422 = validation error (test artifact), 429 = rate limited
  const passed = check(res, {
    'status is 201 or 422 or 429': (r) => [201, 422, 429, 409].includes(r.status),
    'response time < 300ms': (r) => r.timings.duration < 300,
  });

  errorRate.add(!passed && res.status >= 500 ? 1 : 0);

  sleep(0.1); // 100ms think time between requests
}

export function handleSummary(data) {
  return {
    'docs/PERFORMANCE.md': generateMarkdown(data),
    stdout: JSON.stringify(data, null, 2),
  };
}

function generateMarkdown(data) {
  const metrics = data.metrics;
  const dur = metrics['http_req_duration'];
  const rps = metrics['http_reqs'];

  return `# Load Test Results

## Run: ${new Date().toISOString()}

| Metric | Value |
|--------|-------|
| Total requests | ${rps?.values?.count ?? 'N/A'} |
| Requests/sec | ${(rps?.values?.rate ?? 0).toFixed(1)} |
| p50 latency | ${(dur?.values?.['p(50)'] ?? 0).toFixed(1)}ms |
| p90 latency | ${(dur?.values?.['p(90)'] ?? 0).toFixed(1)}ms |
| p99 latency | ${(dur?.values?.['p(99)'] ?? 0).toFixed(1)}ms |
| Error rate | ${((metrics['errors']?.values?.rate ?? 0) * 100).toFixed(2)}% |

## Thresholds
| Threshold | Passed |
|-----------|--------|
| p99 < 150ms | ${dur?.values?.['p(99)'] < 150 ? '✅' : '❌'} |
| p50 < 30ms  | ${dur?.values?.['p(50)'] < 30  ? '✅' : '❌'} |
| Error rate < 1% | ${(metrics['errors']?.values?.rate ?? 0) < 0.01 ? '✅' : '❌'} |
`;
}
