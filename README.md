# n8n-nodes-pdfops

n8n community node for the [PDFops](https://pdfops.dev) API: fill PDF forms,
merge, split, rotate, watermark, number, protect and unlock PDFs, add form
fields, stamp text, images and barcodes, extract and find text, attach files,
convert HTML, text and images to PDF, read and set metadata, and generate
invoice PDFs (including Factur-X e-invoices). The processing runs on the hosted
API, so there is no native dependency to install.

**Works without an API key** (100 requests per IP per month). A free API key
(250 requests/month, no card) raises the quota and unlocks usage introspection:
get one in 60 seconds at [pdfops.dev/docs/signup#n8n](https://pdfops.dev/docs/signup#n8n).

The node is also usable as a tool by n8n's AI Agent; every operation and
parameter carries a description written for that.

## Installation

This community node is **verified by n8n**. On a self-hosted instance install it
from **Settings → Community Nodes → Install** → `n8n-nodes-pdfops`.

## Operations

Operations are grouped by resource: **Form** (Add Fields, Detect Fields, Fill, Inspect Fields, Make Fillable), **Document**
(Delete Pages, Extract Pages, Merge, Rotate Pages, Split PDF), **Stamp** (Add Page Numbers, Add
Watermark, Edit), **Text** (Extract, Find), **Attachment** (Attach), **Convert** (HTML to PDF,
Images to PDF, Text to PDF), **Security** (Protect, Unlock), **Metadata** (Get, Set), **Invoice**
(Generate) and **Account** (Get Usage). Workflows built on 0.2.x keep their original five
operations.

Every PDF operation reads the input PDF from a binary field (default `data`).
Operations that return a PDF write it to an output binary field (default `data`)
and set `fileName` on the item JSON. The Convert operations other than Images to PDF take text
instead of a binary input.

| Resource → Operation | What it does | Key parameters |
| --- | --- | --- |
| **Form → Inspect Fields** | Lists a PDF's AcroForm fields (names, types, options, current values, optional `label`) plus a paste-ready fill template. Use it first on unfamiliar PDFs. | Input Binary Field, Input PDF Password |
| **Form → Fill** | Fills AcroForm fields and outputs the filled PDF. Field names are matched forgivingly; when a key was not an exact match, the item JSON carries `field_map` (`{ "what you sent": "field it resolved to" }`). | Fields (JSON object), Flatten, Input PDF Password |
| **Document → Merge** | Merges the PDFs from **all incoming items** (in item order) into one PDF. The Input PDF Password applies to every input. | Input Binary Field, Input PDF Password |
| **Invoice → Generate** | Turns structured JSON (from, to, items, tax, currency…) into a US-Letter invoice PDF, no template needed. With **Factur-X E-Invoice** on it produces a PDF/A-3 with the invoice data embedded as `factur-x.xml` (EN 16931 profile). That mode needs invoice_number, date, currency, due or payment_terms, `from`/`to` country, the seller's vat_id, and a unit code on every item; put street, postcode, city and vat_id in the party objects of the Invoice JSON. Tested with the Mustang validator; not a statement of legal compliance, and XRechnung and Peppol output are not produced. | Invoice (JSON), Factur-X E-Invoice, E-Invoice Options (IBAN, Payment Terms, Tax Category, Tax Exemption Reason) |
| **Document → Extract Pages** | Keeps only the listed pages, in the order given (also reorders or duplicates pages). | Pages, e.g. `1-3,5,8-` |
| **Document → Delete Pages** | Removes the listed pages; the rest stay in order. Deleting every page is an error. | Pages to Delete, e.g. `2,4-6,9-` |
| **Document → Rotate Pages** | Rotates all or selected pages. | Degrees (90, 180, 270, -90), Pages (empty = all) |
| **Document → Split PDF** | Splits a PDF into parts. Emits **one item per part**, each with its own PDF binary and JSON `{ pages, page_count, part }`. | Split By: Page Ranges (`1-2,3-5`) or Chunk Size (pages per part); Output File Name is the part-name prefix |
| **Stamp → Add Watermark** | Stamps text over the pages. | Watermark Text; options: Opacity (0.05-1, default 0.15), Size, Color, Rotation (default 45), Position (center/top/bottom); Pages |
| **Stamp → Add Page Numbers** | Stamps page numbers. | Options: Format (default `{n} / {total}`), Position (six corners/edges), Size, Start Number, Margin; Pages |
| **Security → Unlock** | Saves a PDF without encryption and without print/copy/modify restrictions. It does not crack passwords: it opens files you can already open (give the Input PDF Password if opening needs one). `note` is set on the item when the input was not encrypted. | Input PDF Password |
| **Security → Protect** | Encrypts a PDF with an open password and/or an owner password, optionally limiting what viewers may do. Output is not byte-stable between calls (encryption is salted). | Open Password, Owner Password (at least one), Allowed Permissions (print, copy, modify, annotate, fill forms) |
| **Metadata → Get** | Returns JSON: page count, page sizes and rotation, title, author, subject, keywords, creator, producer, dates, `encrypted`, `has_form`, `form_field_count`. | Input PDF Password |
| **Metadata → Set** | Sets title, author, subject, keywords or creator and outputs the updated PDF. | Metadata fields (at least one) |
| **Account → Get Usage** | Returns tier, quota, used, remaining and reset date for your API key (needs a credential). | - |
| **Form → Add Fields** | Creates fillable AcroForm fields (text, multiline, checkbox, radio group, dropdown, signature box) at exact positions. The signature type is an empty field for a signing tool; nothing is signed. | Fields to Add (JSON array: type, name, page, x, y, width, height, options...), Input PDF Password |
| **Form → Detect Fields** | Suggests text and checkbox fields for a flat PDF (no form fields yet) and returns them as JSON: `count`, `truncated`, `nextPages` and `fields` (type, name from the nearest printed label, page, x, y, width, height, label, confidence). Detects fields drawn as lines, boxes, underscores and checkboxes; review the result. The PDF is not changed. | Pages; options: Max Pages (default 40), Min Confidence (default 0.4), Input PDF Password |
| **Form → Make Fillable (Detect Fields)** | Detects the fields and adds them in one call: outputs the fillable PDF as binary data, and the item JSON carries `fields_count`, `field_names`, `truncated`, `next_pages`, `pages_skipped` and `warning` when they apply. Nothing found is the error `no_fields`. Long documents are handled for you: the node sends the result back with the pages not done (up to 25 calls per item), continues past `no_fields` while pages are left, and reports `pages_skipped` and the first `warning`. When the loop ends early you get a partial result (the PDF so far with `truncated` true, `next_pages`, `stopped_by` = `{code, message}` and a `message`; code is `stalled`, `max_rounds` or the API error code of the failed call) only if at least one field was added, so you can resume; otherwise the item fails with an error that carries the stop code and the pages left. Review the result. | Pages; options: Max Pages, Min Confidence; Input PDF Password, Output Binary Field, Output File Name |
| **Stamp → Edit** | Draws text, images (a logo, a signature picture), QR codes and barcodes at exact positions. x and y are PDF points from the bottom-left of the page as displayed. | Items (JSON array), Image Files (binary field plus the name Items refer to), Input PDF Password |
| **Text → Extract** | Reads the text layer of a born-digital PDF (no OCR; scanned pages are listed in `pagesWithoutText`). JSON with per-page text, positioned lines and tables; Plain Text returns `{ text, truncated }`; Tables As Excel Workbook returns an `.xlsx` as binary data with its own mime type (one sheet per table) and fails with `no_tables` when the pages hold none. | Result Format (JSON, Plain Text), Tables As (JSON Rows, CSV, Excel Workbook), Pages, Output Binary Field and Output File Name (workbook) |
| **Text → Find** | Searches the text layer for a word, phrase or regex and returns each hit with its page and box in the same coordinates Stamp → Edit uses. When `truncated` is true and `nextPage` is set, run again with Pages set to `<nextPage>-`. | Query; options: Case Sensitive, Max Hits (default 100), Regex, Whole Word; Pages |
| **Attachment → Attach** | Embeds files (for example an XML invoice) in a PDF with a name, MIME type, description and PDF/A-3 relationship. Up to 10 files, 3 MB combined. `attachment_keys` is set on the item. | Files to Attach (binary field, Name, MIME Type, Description, Relationship), Input PDF Password |
| **Convert → HTML to PDF** | Renders an HTML string with a headless browser (CSS, images and web fonts as in a browser print). HTML text only, no URL input, JavaScript off. Each call counts as 5 requests against your quota. | HTML; options: Page Size, Landscape, Margin, Print Background, Scale |
| **Convert → Images to PDF** | Turns the JPG or PNG images from **all incoming items** (in item order) into one PDF, one image per page. | Input Binary Field; options: Page Size (Fit to Image, A4, Letter), Orientation, Margin |
| **Convert → Text to PDF** | Turns Markdown, plain text or CSV into a PDF with built-in fonts, no template. Latin (WinAnsi) characters only. | Content; options: Format, Page Size, Margin, Font Size, Title, Page Numbers, Monospace |

Page specs are 1-based: comma-separated pages and ranges, `8-` meaning page 8
to the end. All operations that read a PDF accept an **Input PDF Password** for inputs that need one to open.
Output is deterministic (the same input gives a byte-identical PDF) for every PDF-producing
operation except Security → Protect (salted encryption) and Convert → HTML to PDF (rendered by a
browser, so two renders can differ in bytes). Extract Text, Find Text and Detect Fields only read.

Errors carry the API's own message (for example which AcroForm field name was
wrong). With **Continue on Fail** a failing item becomes `{ error, message }`
and the other items still complete.

## Credentials

Create a **PDFops API** credential with your API key (sent as `X-API-Key`).
It is optional for every operation except **Account → Get Usage**; without it, requests
count against the anonymous per-IP quota (100/month).

## Example: invoice on every Stripe payment

1. **Stripe Trigger** (`payment_intent.succeeded`)
2. **PDFops**: Invoice → Generate, mapping customer and line items into the invoice JSON
3. **Write Binary File** / email / upload the resulting PDF

More workflows and recipes: [pdfops.dev/pdf-api-for-n8n](https://pdfops.dev/pdf-api-for-n8n).

## Resources

- [PDF API for n8n](https://pdfops.dev/pdf-api-for-n8n)
- [API documentation](https://pdfops.dev/docs)
- [OpenAPI 3.1 spec](https://pdfops.dev/openapi.json)
- [n8n community nodes docs](https://docs.n8n.io/integrations/community-nodes/)

## License

MIT
