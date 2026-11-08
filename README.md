# n8n-nodes-pdfops

n8n community node for the [PDFops](https://pdfops.dev) API: fill PDF forms,
merge, split, rotate, watermark, number, protect and unlock PDFs, read and set
metadata, and generate invoice PDFs. The processing runs on the hosted API, so
there is no headless browser and no native dependency to install.

**Works without an API key** (100 requests per IP per month). A free API key
(250 requests/month, no card) raises the quota and unlocks usage introspection:
get one in 60 seconds at [pdfops.dev/docs/signup#n8n](https://pdfops.dev/docs/signup#n8n).

The node is also usable as a tool by n8n's AI Agent; every operation and
parameter carries a description written for that.

## Installation

This community node is **verified by n8n**. On a self-hosted instance install it
from **Settings → Community Nodes → Install** → `n8n-nodes-pdfops`.

## Operations

Every PDF operation reads the input PDF from a binary field (default `data`).
Operations that return a PDF write it to an output binary field (default `data`)
and set `fileName` on the item JSON.

| Operation | What it does | Key parameters |
| --- | --- | --- |
| **Inspect Fields** | Lists a PDF's AcroForm fields (names, types, options, current values, optional `label`) plus a paste-ready fill template. Use it first on unfamiliar PDFs. | Input Binary Field |
| **Fill Form** | Fills AcroForm fields and outputs the filled PDF. Field names are matched forgivingly; when a key was not an exact match, the item JSON carries `field_map` (`{ "what you sent": "field it resolved to" }`). | Fields (JSON object), Flatten |
| **Merge** | Merges the PDFs from **all incoming items** (in item order) into one PDF. | Input Binary Field |
| **Generate Invoice** | Turns structured JSON (from, to, items, tax, currency…) into a US-Letter invoice PDF, no template needed. | Invoice (JSON) |
| **Extract Pages** | Keeps only the listed pages, in the order given (also reorders or duplicates pages). | Pages, e.g. `1-3,5,8-` |
| **Delete Pages** | Removes the listed pages; the rest stay in order. Deleting every page is an error. | Pages to Delete, e.g. `2,4-6,9-` |
| **Rotate Pages** | Rotates all or selected pages. | Degrees (90, 180, 270, -90), Pages (empty = all) |
| **Split PDF** | Splits a PDF into parts. Emits **one item per part**, each with its own PDF binary and JSON `{ pages, page_count, part }`. | Split By: Page Ranges (`1-2,3-5`) or Chunk Size (pages per part); Output File Name is the part-name prefix |
| **Add Watermark** | Stamps text over the pages. | Watermark Text; options: Opacity (0.05-1, default 0.15), Size, Color, Rotation (default 45), Position (center/top/bottom); Pages |
| **Add Page Numbers** | Stamps page numbers. | Options: Format (default `{n} / {total}`), Position (six corners/edges), Size, Start Number, Margin; Pages |
| **Unlock PDF** | Saves a PDF without encryption and without print/copy/modify restrictions. It does not crack passwords: it opens files you can already open (give the Input PDF Password if opening needs one). `note` is set on the item when the input was not encrypted. | Input PDF Password |
| **Protect PDF** | Encrypts a PDF with an open password and/or an owner password, optionally limiting what viewers may do. Output is not byte-stable between calls (encryption is salted). | Open Password, Owner Password (at least one), Allowed Permissions (print, copy, modify, annotate, fill forms) |
| **Get Metadata** | Returns JSON: page count, page sizes and rotation, title, author, subject, keywords, creator, producer, dates, `encrypted`, `has_form`, `form_field_count`. | Input PDF Password |
| **Set Metadata** | Sets title, author, subject, keywords or creator and outputs the updated PDF. | Metadata fields (at least one) |
| **Get Usage** | Returns tier, quota, used, remaining and reset date for your API key (needs a credential). | - |

Page specs are 1-based: comma-separated pages and ranges, `8-` meaning page 8
to the end. All page and document operations accept an **Input PDF Password**
for inputs that need one to open. Output is deterministic (the same input gives
a byte-identical PDF) for every operation except Protect PDF.

Errors carry the API's own message (for example which AcroForm field name was
wrong). With **Continue on Fail** a failing item becomes `{ error, message }`
and the other items still complete.

## Credentials

Create a **PDFops API** credential with your API key (sent as `X-API-Key`).
It is optional for every operation except **Get Usage**; without it, requests
count against the anonymous per-IP quota (100/month).

## Example: invoice on every Stripe payment

1. **Stripe Trigger** (`payment_intent.succeeded`)
2. **PDFops**: Generate Invoice, mapping customer and line items into the invoice JSON
3. **Write Binary File** / email / upload the resulting PDF

More workflows and recipes: [pdfops.dev/pdf-api-for-n8n](https://pdfops.dev/pdf-api-for-n8n).

## Resources

- [PDF API for n8n](https://pdfops.dev/pdf-api-for-n8n)
- [API documentation](https://pdfops.dev/docs)
- [OpenAPI 3.1 spec](https://pdfops.dev/openapi.json)
- [n8n community nodes docs](https://docs.n8n.io/integrations/community-nodes/)

## License

MIT
