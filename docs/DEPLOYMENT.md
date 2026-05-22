# Deployment Guide

## Local Development

```bash
# One command (builds image, starts postgres + redis, runs migrations automatically)
docker-compose up --build

# Or manual
cp .env.example .env
pnpm install
pnpm run migrate
pnpm run seed     # Optional — populates test inventory
pnpm run dev      # Hot-reload dev server
```

## Environment Variables

See `.env.example` for full reference. The following are **required in production**:

| Variable                   | Notes                                                  |
| -------------------------- | ------------------------------------------------------ |
| `DATABASE_URL`             | PostgreSQL connection string with SSL                  |
| `REDIS_URL`                | Redis connection string                                |
| `ADMIN_API_KEY`            | Must not be `dev-admin-key` — service refuses to start |
| `PAYMENT_GATEWAY_API_KEY`  | Stripe secret key                                      |
| `PAYMENT_GATEWAY_BASE_URL` | `https://api.stripe.com`                               |

## Database Migrations

Migrations are **idempotent** and version-tracked in `schema_migrations`. They run automatically on app startup via `runMigrations()`.

For zero-downtime production deploys, run migrations as a pre-deploy step:

```bash
# Kubernetes: Helm hook Job (see k8s/deployment.yml)
# Standalone:
NODE_ENV=production DATABASE_URL="..." pnpm run migrate
```

**Never** apply migrations to production and restart at the same time without testing the migration independently in staging first.

## Docker

### Development

```bash
docker build -f docker/Dockerfile -t orderly:dev .
```

### Production

```bash
# Three-stage build: deps → build → minimal runtime
docker build -f docker/Dockerfile.prod -t orderly:latest .

# Recommended: pin to a specific digest in CI
docker build -f docker/Dockerfile.prod -t orderly:$(git rev-parse --short HEAD) .
```

## Kubernetes

The `k8s/deployment.yml` manifest includes:

- `Deployment` with rolling update (zero-downtime)
- `Service` (ClusterIP)
- `HorizontalPodAutoscaler` (3–20 replicas, CPU 70% / Memory 80%)
- `PodDisruptionBudget` (minAvailable: 2)
- `Job` for pre-deploy migrations (Helm hook)

### Deploy

```bash
# Create secrets first
kubectl create secret generic orderly-secrets \
  --from-literal=database-url="$DATABASE_URL" \
  --from-literal=redis-url="$REDIS_URL" \
  --from-literal=admin-api-key="$ADMIN_API_KEY" \
  --from-literal=payment-gateway-api-key="$PAYMENT_GATEWAY_API_KEY"

kubectl apply -f k8s/deployment.yml
kubectl rollout status deployment/orderly
```

## Observability

Start the observability profile alongside the app:

```bash
docker-compose --profile observability up
```

| Service        | URL                                   |
| -------------- | ------------------------------------- |
| Grafana        | http://localhost:3002 (admin / admin) |
| OTLP collector | http://localhost:4318                 |

## Graceful Shutdown

The app handles `SIGTERM` and `SIGINT`:

1. Stop accepting new HTTP connections (`fastify.close()`)
2. Stop the outbox processor
3. Drain BullMQ workers — max 30 seconds
4. Close PostgreSQL and Redis connection pools
5. Flush OpenTelemetry spans
6. `process.exit(0)`

The Kubernetes `preStop` hook sleeps 15 seconds before termination to give the load balancer time to stop routing traffic. `terminationGracePeriodSeconds: 60` gives the app 45 seconds (60 − 15) for draining.

## Production Checklist

- [ ] `ADMIN_API_KEY` is a cryptographically random string (≥ 32 chars)
- [ ] `DATABASE_URL` uses SSL (`?sslmode=require` or `?ssl=true`)
- [ ] Secrets are stored in a secrets manager (AWS Secrets Manager / HashiCorp Vault)
- [ ] Swagger UI is disabled in production (`NODE_ENV=production`)
- [ ] `pnpm audit` passes with no moderate+ vulnerabilities
- [ ] Database migrations tested in staging before production apply
- [ ] `PodDisruptionBudget` applied before rolling deploys
- [ ] Alerting configured for the thresholds in SPEC §12.5
