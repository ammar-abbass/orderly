# ADR-007: RFC 7807 Problem Details over Custom Error Formats

**Status:** Accepted  
**Date:** 2026-05-15

## Context

API error responses need to be machine-readable, consistent across all endpoints, and self-documenting. Different endpoints returning different error shapes forces clients to implement per-endpoint error parsing.

## Decision

Adopt **RFC 7807** (Problem Details for HTTP APIs) for all error responses. Every error response uses `Content-Type: application/problem+json` and includes the standard fields: `type`, `title`, `status`, `detail`, and `instance`.

## Alternatives Considered

### Custom error envelope (`{ error: string, code: number }`)

**Rejected.** Non-standard, requires custom documentation, and clients cannot use generic error-handling libraries.

### GraphQL-style errors (`{ errors: [{ message, extensions }] }`)

**Not applicable.** This is a REST API.

## Consequences

**Positive:**

- Standardised: clients can parse errors uniformly using any RFC 7807 library
- Extensible: additional fields (e.g. `errors` array for validation) can be added per error type
- Self-documenting: the `type` URI can link to documentation for each error category
- `instance` field maps to the request URL, enabling correlation in logs

**Negative:**

- Slightly larger payloads than a simple `{ error: string }` response
- Must consistently set `Content-Type: application/problem+json` on all error paths
- Developers must remember to use the RFC 7807 format in all new error handlers

## Example

```json
{
  "type": "https://orderly.example.com/errors/validation-error",
  "title": "Validation Error",
  "status": 422,
  "detail": "The request body contains invalid data",
  "instance": "/api/v1/orders",
  "errors": [
    { "field": "items.0.quantity", "message": "Expected positive integer" }
  ]
}
```

## Implementation

All error responses in the codebase follow this pattern via:

- `src/api/middleware/error-handler.ts` — global Fastify error handler that wraps all unhandled errors
- Inline `reply.status(N).type('application/problem+json').send({...})` calls for domain-specific errors (404, 409, 401, 403)
