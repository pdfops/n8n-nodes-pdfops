# n8n-nodes-pdfops

n8n community node for the [PDFops](https://pdfops.dev) API — deterministic
PDF operations for workflows: inspect and fill AcroForm fields, merge PDFs,
and generate invoice PDFs from structured data. No headless browser, no
native dependencies; PDF processing runs on the hosted API.

Works keyless out of the box (100 requests/IP/month). A free API key
(250 requests/month, no card) raises the quota and unlocks usage
introspection — get one in 60 seconds at
[pdfops.dev/docs/signup#n8n](https://pdfops.dev/docs/signup#n8n), which also has
a credentialed example workflow.

## Installation

This community node is **verified by n8n** (listed in n8n's verified
community-node registry since 2026-08-13).

**Self-hosted** — **Settings → Community Nodes → Install** →
`n8n-nodes-pdfops`, or from the CLI:

```bash
n8n community-node install n8n-nodes-pdfops
```

## Operations

| Operation | What it does |
| --- | --- |
| **Inspect Fields** | Lists a PDF's AcroForm fields — names, types, options, current values — plus a paste-ready fill template. Use it first on unfamiliar PDFs. |
| **Fill Form** | Fills AcroForm fields in a PDF (from a binary field) and outputs the filled PDF as binary data. Optionally **Flatten** the result to lock the values into the page (fields become non-interactive). |
| **Merge** | Merges the PDFs from **all incoming items** (in item order) into a single output PDF. |
| **Generate Invoice** | Turns structured JSON (from, to, items, tax, currency…) into a complete US-Letter invoice PDF — no template needed. |
| **Get Usage** | Returns tier, quota, used, remaining, and reset date for your API key. |

Fill, merge, and invoice are **deterministic**: the same input produces a
byte-identical PDF, so re-running a workflow never produces spurious diffs.

## Credentials

Create a **PDFops API** credential with your API key (sent as `X-API-Key`).
The credential is optional for every operation except **Get Usage** — without
it, requests count against the anonymous per-IP quota.

## Example: invoice on every Stripe payment

1. **Stripe Trigger** (`payment_intent.succeeded`)
2. **PDFops** — Generate Invoice, mapping customer + line items into the invoice JSON
3. **Write Binary File** / email / upload the resulting PDF

More recipes: [pdfops.dev/blog](https://pdfops.dev/blog).

## Resources

- [API documentation](https://pdfops.dev/docs)
- [OpenAPI 3.1 spec](https://pdfops.dev/openapi.json)
- [n8n community nodes docs](https://docs.n8n.io/integrations/community-nodes/)

## License

MIT
