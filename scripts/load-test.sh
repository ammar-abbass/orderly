#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Orderly load test runner
# Prerequisites: k6 installed, Orderly running at BASE_URL
# ─────────────────────────────────────────────────────────────────────────────

BASE_URL="${BASE_URL:-http://localhost:3000}"
RESULTS_DIR="tests/load/results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "Orderly Load Test Runner"
echo "========================"
echo "Target: ${BASE_URL}"

# Check k6 is installed
if ! command -v k6 &>/dev/null; then
  echo ""
  echo "Error: k6 is not installed."
  echo "Install from: https://k6.io/docs/get-started/installation/"
  echo ""
  echo "macOS:  brew install k6"
  echo "Linux:  sudo snap install k6"
  echo "Docker: docker run -i grafana/k6 run -"
  exit 1
fi

# Check the service is reachable
if ! curl -sf "${BASE_URL}/health" >/dev/null; then
  echo ""
  echo "Error: Service not reachable at ${BASE_URL}/health"
  echo "Start it with: docker-compose up"
  exit 1
fi

# Ensure inventory is seeded
echo ""
echo "Seeding inventory..."
pnpm run seed

# Run migrations (idempotent)
mkdir -p "${RESULTS_DIR}"

echo ""
echo "Starting k6 load test..."
echo "Results: ${RESULTS_DIR}/run_${TIMESTAMP}.json"
echo ""

k6 run \
  --env BASE_URL="${BASE_URL}" \
  --out "json=${RESULTS_DIR}/run_${TIMESTAMP}.json" \
  tests/load/flash-sale.js

echo ""
echo "Load test complete."
echo "Results saved to: ${RESULTS_DIR}/run_${TIMESTAMP}.json"
echo ""
echo "Summary written to: docs/PERFORMANCE.md"
