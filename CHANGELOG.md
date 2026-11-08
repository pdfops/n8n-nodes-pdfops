# Changelog

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
