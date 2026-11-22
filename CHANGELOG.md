# Changelog

## 0.5.0

- **Eight new operations**, grouped under resources so no operation list has more than five
  options (the scanner rule behind the 0.3.x rejection): Form → Add Fields, Stamp → Edit,
  Attachment → Attach, Text → Extract and Find, Convert → HTML to PDF, Images to PDF and Text to
  PDF. Operation values are `addFields`, `edit`, `attach`, `extractText`, `findText`, `htmlToPdf`,
  `imageToPdf` and `textToPdf`. Existing operations, values and parameter names are unchanged.
- **Extract Text** reads the text layer as JSON, as plain text (`{ text, truncated }`), or, with
  Tables As set to Excel Workbook (`tables_format=xlsx`), as binary data with the `.xlsx` mime type
  and the file name you choose. Tables As CSV adds a `csv` string to each table. When a workbook is
  cut short the item JSON carries `truncated`, `truncated_by` and `cells_truncated`.
- **Generate Invoice gains Factur-X E-Invoice**: a switch that sends `e_invoice: "factur-x"`, plus an
  E-Invoice Options collection (IBAN, Payment Terms, Tax Category, Tax Exemption Reason). The
  structured `from` and `to` addresses (country, street, postcode, city, vat_id) and the item
  `unit` go in the Invoice JSON, whose description now lists them.
- **Images to PDF** merges the images from all incoming items into one PDF, like Merge does for
  PDFs. **Attach Files** returns `attachment_keys` on the item JSON.
- **Hardening**: requests never follow redirects (the credential header would otherwise travel to
  another origin); Factur-X no longer writes into the Invoice object it was given; the Factur-X
  switch is version 2 only, so version 1 stays as n8n verified it; an empty binary file name falls
  back to the binary field name instead of dropping the file part; Edit rejects duplicate, empty and
  odd Image File names (allowed: 1-64 of letters, digits, `_`, `.`, `-`) before any request; Images
  to PDF honours Continue On Fail for parameter errors and pairs its error item with every input.
- Response details are surfaced more carefully: `attachment_keys` only on Attach (always an array of
  `{ name, key }`), truncation fields only on Extract, a non-workbook body on the workbook path is an
  error, Add Fields returns `warning`, HTML to PDF returns `pages` and `blocked_requests`. Protect's
  password help now says 1-32 characters (the API limit), and the Find Text and Factur-X help were
  corrected.
- Search aliases in the codex file for every new operation.
- The mock harness (`harness/edgesuite.json`, `harness/edgesuite.py`) exercises the new operations,
  including the binary outputs, in n8n against a mock of the API.

## 0.4.0

- **Operations are grouped by resource** (node version 2): Form (Fill, Inspect Fields), Document
  (Delete Pages, Extract Pages, Merge, Rotate Pages, Split PDF), Stamp (Add Page Numbers, Add
  Watermark), Security (Protect, Unlock), Metadata (Get, Set), Invoice (Generate) and Account (Get
  Usage). n8n's verification scanner requires resources once a node has more than five operations,
  so 0.3.0 and 0.3.1 never passed n8n's review. Operation values and parameter names are unchanged.
- **Workflows from 0.2.x keep working**: nodes saved on version 1 keep its five operations (Fill
  Form, Inspect Fields, Merge, Generate Invoice, Get Usage). A version-1 node from 0.3.x that uses one
  of the ten operations added in 0.3.0 needs replacing with a new PDFops node.

## 0.3.1

- **Input PDF Password on Fill Form, Inspect Fields and Merge PDFs.** The optional password
  parameter already offered on the page and document operations now applies to the three original
  operations too. Owner-locked PDFs (empty user password, common for government blanks) open
  without it; a user-password PDF needs it. For Merge PDFs the password from the first item is
  applied to every input.
- Package description now names every operation (fill, merge, split, rotate, watermark, page
  numbers, protect, unlock, metadata, inspect, invoices).

## 0.3.0

- **Ten new operations**: Extract Pages, Delete Pages, Rotate Pages, Split PDF, Add Watermark,
  Add Page Numbers, Unlock PDF, Protect PDF, Get Metadata, Set Metadata. Existing operations and
  parameter names are unchanged.
- **Split PDF emits one item per part**, each with its own PDF binary and JSON
  `{ pages, page_count, part }`.
- **Fill Form returns `field_map`** on the item JSON when the API matched any field name
  non-exactly (`x-pdfops-field-map`). Unlock PDF returns `note` when the input was not encrypted.
- New operations share the existing error handling: the API's own message is shown, and
  Continue on Fail yields `{ error, message }` items.
- Discovery: the node description now says what it does and that it works without an API key;
  the codex file gains search aliases for every operation; README rewritten as a full listing.

## 0.2.2

- **Show the API's real error when a credential is set.** Keyed requests fail as a
  NodeApiError, which hides the response body, so users saw "Bad request" instead of
  the field the API named. Merge errors are decoded the same way now.
- **Continue on Fail keeps earlier items.** A bad item (missing binary, bad JSON) no
  longer throws out of the node and loses the items already processed.
- **A selected credential that fails to load now errors** instead of silently running
  keyless.
- **Error items are `{ error, message }`** rather than `{ error, details }`, the shape
  every n8n version routes to the error output.

## 0.2.1

- Surface the API's `{ error, details }` on failed calls instead of a bare "Bad request".
- Send the `X-Pdfops-Client-Version` header.

## 0.2.0

- **Fill Form: add "Flatten" option.** When enabled, the filled values are baked
  into the page so the fields are no longer interactive — useful for locking a
  form before sending or archiving. Off by default (output stays an editable
  AcroForm). Maps to the API's `flatten=true`.

## 0.1.1

- Fix the codex `node` identifier to `n8n-nodes-pdfops.pdfops` (verified-badge review).

## 0.1.0

- Initial release: Inspect Fields, Fill Form, Merge, Generate Invoice, Get Usage.
  Published with npm provenance.
