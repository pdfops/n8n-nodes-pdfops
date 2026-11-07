# Changelog

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
