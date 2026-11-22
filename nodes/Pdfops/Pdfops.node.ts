// PDFops node — deterministic PDF operations via the PDFops API.
//
// Programmatic style (not declarative) because every operation except
// `usage` moves binary data: multipart PDF uploads built from n8n binary
// properties, and `application/pdf` responses written back as binary
// output. Declarative routing has no binary composition/handling hooks.

import type {
	IExecuteFunctions,
	IHttpRequestOptions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
	IDataObject,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { decodeApiError } from './decodeApiError';

const BASE_URL = 'https://pdfops.dev';

/** Sent as X-Pdfops-Client-Version — keep in step with n8n/package.json (asserted in tests). */
const NODE_PACKAGE_VERSION = '0.5.0';

/** A response header counts as true when its first comma-separated token is "true". */
function headerTrue(value: unknown): boolean {
	return typeof value === 'string' && value.split(',')[0].trim().toLowerCase() === 'true';
}

/**
 * new NodeApiError(error) hands back an existing NodeApiError unchanged and ignores
 * its options, so the decoded message has to be set on the result.
 */
function withApiMessage(
	wrapped: NodeApiError,
	apiError: ReturnType<typeof decodeApiError>,
	itemIndex?: number,
): NodeApiError {
	if (itemIndex !== undefined) wrapped.context = { ...wrapped.context, itemIndex };
	if (apiError) {
		wrapped.message = apiError.message;
		wrapped.description = apiError.details ?? null;
	}
	return wrapped;
}

/** Page and document operations: all POST one `pdf` (+ optional `password`) as multipart. */
const DOC_OPS: Record<string, { path: string; output: 'pdf' | 'json' | 'parts' | 'extract'; defaultFile: string }> = {
	extractPages: { path: 'extract-pages', output: 'pdf', defaultFile: 'extracted.pdf' },
	deletePages: { path: 'delete-pages', output: 'pdf', defaultFile: 'pages-deleted.pdf' },
	rotate: { path: 'rotate', output: 'pdf', defaultFile: 'rotated.pdf' },
	split: { path: 'split', output: 'parts', defaultFile: 'split' },
	watermark: { path: 'watermark', output: 'pdf', defaultFile: 'watermarked.pdf' },
	pageNumbers: { path: 'page-numbers', output: 'pdf', defaultFile: 'numbered.pdf' },
	unlock: { path: 'unlock', output: 'pdf', defaultFile: 'unlocked.pdf' },
	protect: { path: 'protect', output: 'pdf', defaultFile: 'protected.pdf' },
	metadata: { path: 'metadata', output: 'json', defaultFile: '' },
	setMetadata: { path: 'set-metadata', output: 'pdf', defaultFile: 'metadata-updated.pdf' },
	addFields: { path: 'add-fields', output: 'pdf', defaultFile: 'fields-added.pdf' },
	attach: { path: 'attach', output: 'pdf', defaultFile: 'attached.pdf' },
	edit: { path: 'edit', output: 'pdf', defaultFile: 'edited.pdf' },
	extractText: { path: 'extract-text', output: 'extract', defaultFile: 'tables.xlsx' },
	findText: { path: 'find-text', output: 'json', defaultFile: '' },
};

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Version 1 is what n8n verified (0.2.1): five operations, no resources. Version 2 groups every
// operation by resource, which n8n's scanner requires once a node has more than five. The lists are
// written out literally on purpose: n8n's lint rules (and its verification scanner) read the source
// statically and crash on option lists built from references. tests/n8n-node-operations.test.ts
// keeps the v1 and v2 copies of each option in step.
const OPERATION_PROPERTIES: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { '@version': [1] } },
		options: [
			{
				name: 'Fill Form',
				value: 'fill',
				action: 'Fill form fields in a PDF',
				description:
					'Fill AcroForm form fields in a PDF and output the filled PDF',
			},
			{
				name: 'Generate Invoice',
				value: 'invoice',
				action: 'Generate an invoice PDF',
				description:
					'Generate a complete invoice PDF from structured JSON — no template needed',
			},
			{
				name: 'Get Usage',
				value: 'usage',
				action: 'Get quota usage',
				description:
					'Check tier, limit, used, remaining, and reset date (requires an API key)',
			},
			{
				name: 'Inspect Fields',
				value: 'inspect',
				action: 'List the form fields of a PDF',
				description:
					'List a PDF’s AcroForm fields — names, types, options, current values — plus a paste-ready fill template',
			},
			{
				name: 'Merge',
				value: 'merge',
				action: 'Merge many PDF files into one',
				description:
					'Merge the PDFs from all incoming items (in item order) into a single PDF',
			},
		],
		default: 'fill',
	},
	{
		displayName: 'Resource',
		name: 'resource',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { '@version': [2] } },
		options: [
			{ name: 'Account', value: 'account' },
			{ name: 'Attachment', value: 'attachment' },
			{ name: 'Convert', value: 'convert' },
			{ name: 'Document', value: 'document' },
			{ name: 'Form', value: 'form' },
			{ name: 'Invoice', value: 'invoice' },
			{ name: 'Metadata', value: 'metadata' },
			{ name: 'Security', value: 'security' },
			{ name: 'Stamp', value: 'stamp' },
			{ name: 'Text', value: 'text' },
		],
		default: 'form',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { '@version': [2], resource: ['account'] } },
		options: [
			{
				name: 'Get Usage',
				value: 'usage',
				action: 'Get quota usage',
				description:
					'Check tier, limit, used, remaining, and reset date (requires an API key)',
			},
		],
		default: 'usage',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { '@version': [2], resource: ['attachment'] } },
		options: [
			{
				name: 'Attach',
				value: 'attach',
				action: 'Attach files to a PDF',
				description:
					'Embed files (an XML invoice, a spreadsheet, a source file) inside a PDF and output the updated PDF',
			},
		],
		default: 'attach',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { '@version': [2], resource: ['convert'] } },
		options: [
			{
				name: 'HTML to PDF',
				value: 'htmlToPdf',
				action: 'Convert HTML to a PDF',
				description:
					'Render an HTML string to a PDF with a headless browser, so CSS, images and web fonts come out as in a browser print. Each call counts as 5 requests against your quota.',
			},
			{
				name: 'Images to PDF',
				value: 'imageToPdf',
				action: 'Convert images to a PDF',
				description:
					'Turn the JPG or PNG images from all incoming items (in item order) into one PDF, one image per page',
			},
			{
				name: 'Text to PDF',
				value: 'textToPdf',
				action: 'Convert text to a PDF',
				description:
					'Turn Markdown, plain text or CSV into a PDF on A4 or Letter pages, without a template',
			},
		],
		default: 'htmlToPdf',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { '@version': [2], resource: ['document'] } },
		options: [
			{
				name: 'Delete Pages',
				value: 'deletePages',
				action: 'Delete pages from a PDF',
				description:
					'Remove the listed pages from a PDF and output the remaining pages in original order',
			},
			{
				name: 'Extract Pages',
				value: 'extractPages',
				action: 'Extract pages from a PDF',
				description:
					'Keep only the listed pages of a PDF, in the order given, and output them as a new PDF (also reorders and duplicates pages)',
			},
			{
				name: 'Merge',
				value: 'merge',
				action: 'Merge many PDF files into one',
				description:
					'Merge the PDFs from all incoming items (in item order) into a single PDF',
			},
			{
				name: 'Rotate Pages',
				value: 'rotate',
				action: 'Rotate pages of a PDF',
				description:
					'Rotate all or selected pages of a PDF by 90, 180 or 270 degrees',
			},
			{
				name: 'Split PDF',
				value: 'split',
				action: 'Split a PDF into several pdfs',
				description:
					'Split a PDF by page ranges or fixed chunk size; outputs one item per part, each with its own PDF binary',
			},
		],
		default: 'merge',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { '@version': [2], resource: ['form'] } },
		options: [
			{
				name: 'Add Fields',
				value: 'addFields',
				action: 'Add form fields to a PDF',
				description:
					'Create fillable form fields (text, checkbox, radio group, dropdown, signature box) at exact positions in a PDF',
			},
			{
				name: 'Fill',
				value: 'fill',
				action: 'Fill form fields in a PDF',
				description:
					'Fill AcroForm form fields in a PDF and output the filled PDF',
			},
			{
				name: 'Inspect Fields',
				value: 'inspect',
				action: 'List the form fields of a PDF',
				description:
					'List a PDF’s AcroForm fields — names, types, options, current values — plus a paste-ready fill template',
			},
		],
		default: 'fill',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { '@version': [2], resource: ['invoice'] } },
		options: [
			{
				name: 'Generate',
				value: 'invoice',
				action: 'Generate an invoice PDF',
				description:
					'Generate a complete invoice PDF from structured JSON — no template needed',
			},
		],
		default: 'invoice',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { '@version': [2], resource: ['metadata'] } },
		options: [
			{
				name: 'Get',
				value: 'metadata',
				action: 'Get PDF metadata',
				description:
					'Read page count, page sizes, title, author, dates, encryption and form-field count of a PDF as JSON',
			},
			{
				name: 'Set',
				value: 'setMetadata',
				action: 'Set PDF metadata',
				description:
					'Set the title, author, subject, keywords or creator of a PDF and output the updated PDF',
			},
		],
		default: 'metadata',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { '@version': [2], resource: ['security'] } },
		options: [
			{
				name: 'Protect',
				value: 'protect',
				action: 'Password protect a PDF',
				description:
					'Encrypt a PDF with an open password and/or an owner password that restricts printing, copying and editing',
			},
			{
				name: 'Unlock',
				value: 'unlock',
				action: 'Remove password protection from a PDF',
				description:
					'Remove encryption and print/copy/edit restrictions from a PDF you can already open (give the password if it needs one to open)',
			},
		],
		default: 'protect',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { '@version': [2], resource: ['stamp'] } },
		options: [
			{
				name: 'Add Page Numbers',
				value: 'pageNumbers',
				action: 'Add page numbers to a PDF',
				description:
					'Stamp page numbers (for example "3 / 12") onto the pages of a PDF and output the numbered PDF',
			},
			{
				name: 'Add Watermark',
				value: 'watermark',
				action: 'Add a text watermark to a PDF',
				description:
					'Stamp diagonal or horizontal text (DRAFT, CONFIDENTIAL, a name) over the pages of a PDF and output the watermarked PDF',
			},
			{
				name: 'Edit',
				value: 'edit',
				action: 'Add text images or barcodes to a PDF',
				description:
					'Draw text, images (a logo, a signature), QR codes and barcodes at exact positions on the pages of a PDF and output the edited PDF',
			},
		],
		default: 'watermark',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { '@version': [2], resource: ['text'] } },
		options: [
			{
				name: 'Extract',
				value: 'extractText',
				action: 'Extract text and tables from a PDF',
				description:
					'Read the text of a PDF with a text layer, page by page, plus the tables found on the pages, as JSON, plain text or an Excel workbook. Scanned pages are not read (no OCR).',
			},
			{
				name: 'Find',
				value: 'findText',
				action: 'Find text in a PDF',
				description:
					'Search a PDF with a text layer for a word, phrase or pattern and return every hit with its page and its box in PDF points',
			},
		],
		default: 'extractText',
	},
];

export class Pdfops implements INodeType {
	description: INodeTypeDescription = {
		// Search in n8n's AI builder matches only name and displayName, by word start (TASK-391), so the
		// jobs are in the name. defaults.name below keeps the canvas label short.
		displayName: 'PDFops: Fill PDF Forms, Merge, Invoice',
		name: 'pdfops',
		icon: { light: 'file:pdfops.svg', dark: 'file:pdfops.dark.svg' },
		group: ['transform'],
		// 2 groups the operations under resources (n8n's resource-operation-pattern rule, an error in
		// its verification scanner since 2026-10-13). 1 keeps the flat list so saved workflows still open.
		version: [1, 2],
		defaultVersion: 2,
		subtitle: '={{ ($parameter["resource"] ? $parameter["resource"] + ": " : "") + $parameter["operation"] }}',
		description:
			'Fill, merge, split, rotate, watermark, number, protect, unlock, edit, read and search PDFs, add form fields and attachments, convert HTML, text and images to PDF, and generate invoices. Works without an API key (100 calls/month).',
		defaults: {
			name: 'PDFops',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'pdfopsApi',
				required: false,
			},
		],
		properties: [
			...OPERATION_PROPERTIES,
			{
				displayName: 'Input Binary Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				hint: 'The name of the input item’s binary field containing the PDF',
				displayOptions: {
					show: {
						operation: ['fill', 'inspect', 'merge', 'extractPages', 'deletePages', 'rotate', 'split', 'watermark', 'pageNumbers', 'unlock', 'protect', 'metadata', 'setMetadata', 'addFields', 'attach', 'edit', 'extractText', 'findText'],
					},
				},
			},
			{
				displayName: 'Input Binary Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				hint: 'The name of the input item’s binary field containing the image (JPG or PNG)',
				displayOptions: { show: { operation: ['imageToPdf'] } },
			},
			{
				displayName: 'Fields',
				name: 'fields',
				type: 'json',
				default: '{}',
				required: true,
				description:
					'Field name → string value object, e.g. {"customer_name": "Ada"}. Field names must exist in the PDF — use the Inspect Fields operation to discover them. Checkboxes take "true"/"false".',
				displayOptions: {
					show: {
						operation: ['fill'],
					},
				},
			},
			{
				displayName: 'Input PDF Password',
				name: 'password',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				description:
					'Password needed to open the input PDF. Leave empty unless the input is encrypted with an open password.',
				displayOptions: {
					show: {
						operation: [
							'fill',
							'inspect',
							'merge',
							'extractPages',
							'deletePages',
							'rotate',
							'split',
							'watermark',
							'pageNumbers',
							'unlock',
							'protect',
							'metadata',
							'setMetadata',
							'addFields',
							'attach',
							'edit',
							'extractText',
							'findText',
						],
					},
				},
			},
			{
				displayName: 'Pages',
				name: 'pages',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'e.g. 1-3,5,8-',
				description:
					'1-based page spec: comma-separated pages and ranges, e.g. "1-3,5,8-" (8- means page 8 to the end). Keeps exactly these pages in the order given, so "3,1" reorders and "1,1" duplicates.',
				displayOptions: { show: { operation: ['extractPages'] } },
			},
			{
				displayName: 'Pages to Delete',
				name: 'pages',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'e.g. 2,4-6,9-',
				description:
					'1-based page spec of the pages to remove, e.g. "2,4-6,9-" (9- means page 9 to the end). Deleting every page is an error.',
				displayOptions: { show: { operation: ['deletePages'] } },
			},
			{
				displayName: 'Pages',
				name: 'pages',
				type: 'string',
				default: '',
				placeholder: 'e.g. 1-3,5 (empty = all pages)',
				description: '1-based page spec such as "1-3,5". Leave empty to apply to every page.',
				displayOptions: { show: { operation: ['rotate', 'watermark', 'pageNumbers', 'extractText', 'findText'] } },
			},
			{
				displayName: 'Degrees',
				name: 'degrees',
				type: 'options',
				options: [
					{ name: '90 (Clockwise)', value: 90 },
					{ name: '180', value: 180 },
					{ name: '270 (Clockwise)', value: 270 },
					{ name: '-90 (Counter-Clockwise)', value: -90 },
				],
				default: 90,
				description:
					'How far to turn the pages clockwise. Added to each page’s existing rotation, so rotating a page already at 90 by 270 ends at 0.',
				displayOptions: { show: { operation: ['rotate'] } },
			},
			{
				displayName: 'Split By',
				name: 'splitMode',
				type: 'options',
				options: [
					{
						name: 'Page Ranges',
						value: 'ranges',
						description: 'Each comma-separated group becomes one part, e.g. "1-2,3-5" gives two parts',
					},
					{
						name: 'Chunk Size',
						value: 'every',
						description: 'Cut into parts of N pages each (the last part may be shorter)',
					},
				],
				default: 'ranges',
				displayOptions: { show: { operation: ['split'] } },
			},
			{
				displayName: 'Ranges',
				name: 'ranges',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'e.g. 1-2,3-5',
				description:
					'1-based page ranges; every comma-separated group becomes its own part, e.g. "1-2,3-5" gives two PDFs and "1,2,3" gives three single-page PDFs',
				displayOptions: { show: { operation: ['split'], splitMode: ['ranges'] } },
			},
			{
				displayName: 'Pages per Part',
				name: 'every',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 1,
				required: true,
				description:
					'Number of pages in each part; for example 2 on a 5-page PDF gives parts 1-2, 3-4 and 5',
				displayOptions: { show: { operation: ['split'], splitMode: ['every'] } },
			},
			{
				displayName: 'Watermark Text',
				name: 'text',
				type: 'string',
				default: 'DRAFT',
				required: true,
				description:
					'Text to stamp on the pages, at most 200 characters. Latin (WinAnsi) characters only; other scripts are rejected.',
				displayOptions: { show: { operation: ['watermark'] } },
			},
			{
				displayName: 'Watermark Options',
				name: 'watermarkOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { operation: ['watermark'] } },
				options: [
					{
						displayName: 'Color',
						name: 'color',
						type: 'color',
						default: '#808080',
						description: 'Text colour as hex, #rgb or #rrggbb',
					},
					{
						displayName: 'Opacity',
						name: 'opacity',
						type: 'number',
						typeOptions: { minValue: 0.05, maxValue: 1, numberPrecision: 2 },
						default: 0.15,
						description: 'From 0.05 (faint) to 1 (solid)',
					},
					{
						displayName: 'Position',
						name: 'position',
						type: 'options',
						options: [
							{ name: 'Bottom', value: 'bottom' },
							{ name: 'Center', value: 'center' },
							{ name: 'Top', value: 'top' },
						],
						default: 'center',
					},
					{
						displayName: 'Rotation',
						name: 'rotation',
						type: 'number',
						default: 45,
						description: 'Degrees counter-clockwise as the viewer sees it; 0 is horizontal',
					},
					{
						displayName: 'Size',
						name: 'size',
						type: 'number',
						typeOptions: { minValue: 6, maxValue: 200 },
						default: 48,
						description: 'Font size in points (6-200)',
					},
				],
			},
			{
				displayName: 'Page Number Options',
				name: 'pageNumberOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { operation: ['pageNumbers'] } },
				options: [
					{
						displayName: 'Format',
						name: 'format',
						type: 'string',
						default: '{n} / {total}',
						description:
							'Label template. {n} is the page number, {total} the page count of the document, e.g. "Page {n} of {total}". At most 100 Latin characters.',
					},
					{
						displayName: 'Margin',
						name: 'margin',
						type: 'number',
						typeOptions: { minValue: 0, maxValue: 200 },
						default: 24,
						description: 'Distance from the page edge in points (0-200)',
					},
					{
						displayName: 'Position',
						name: 'position',
						type: 'options',
						options: [
							{ name: 'Bottom Center', value: 'bottom-center' },
							{ name: 'Bottom Left', value: 'bottom-left' },
							{ name: 'Bottom Right', value: 'bottom-right' },
							{ name: 'Top Center', value: 'top-center' },
							{ name: 'Top Left', value: 'top-left' },
							{ name: 'Top Right', value: 'top-right' },
						],
						default: 'bottom-center',
					},
					{
						displayName: 'Size',
						name: 'size',
						type: 'number',
						typeOptions: { minValue: 4, maxValue: 72 },
						default: 10,
						description: 'Font size in points (4-72)',
					},
					{
						displayName: 'Start Number',
						name: 'start',
						type: 'number',
						typeOptions: { minValue: 0, maxValue: 100000 },
						default: 1,
						description:
							'Number shown on page 1 of the document. Page i shows start+i-1, even when Pages selects only some pages.',
					},
				],
			},
			{
				displayName: 'Open Password',
				name: 'userPassword',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				description:
					'Password required to open the output PDF (1-32 characters, Latin-1 only). Set this and/or the Owner Password; at least one is required.',
				displayOptions: { show: { operation: ['protect'] } },
			},
			{
				displayName: 'Owner Password',
				name: 'ownerPassword',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				description:
					'Password that lifts the permission restrictions (1-32 characters, Latin-1 only). Restrictions only bind a viewer when an owner password is set.',
				displayOptions: { show: { operation: ['protect'] } },
			},
			{
				displayName: 'Protect Options',
				name: 'protectOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { operation: ['protect'] } },
				options: [
					{
						displayName: 'Allowed Permissions',
						name: 'permissions',
						type: 'multiOptions',
						options: [
							{ name: 'Annotate', value: 'annotate' },
							{ name: 'Copy', value: 'copy' },
							{ name: 'Fill Forms', value: 'fill-forms' },
							{ name: 'Modify', value: 'modify' },
							{ name: 'Print', value: 'print' },
						],
						default: ['print', 'copy', 'annotate', 'fill-forms'],
						description:
							'What viewers may do. Leave this option out to allow everything (except modify when an owner password is set); select none to allow nothing.',
					},
				],
			},
			{
				displayName: 'Metadata',
				name: 'metadataFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				description: 'At least one field is required; an empty value clears that field',
				displayOptions: { show: { operation: ['setMetadata'] } },
				options: [
					{ displayName: 'Author', name: 'author', type: 'string', default: '' },
					{ displayName: 'Creator', name: 'creator', type: 'string', default: '' },
					{
						displayName: 'Keywords',
						name: 'keywords',
						type: 'string',
						default: '',
						description: 'Comma-separated list',
					},
					{ displayName: 'Subject', name: 'subject', type: 'string', default: '' },
					{ displayName: 'Title', name: 'title', type: 'string', default: '' },
				],
			},
			{
				displayName: 'Fields to Add',
				name: 'formFields',
				type: 'json',
				default:
					'[\n  { "type": "text", "name": "customer_name", "page": 1, "x": 72, "y": 700, "width": 200, "height": 20 }\n]',
				required: true,
				description:
					'JSON array (up to 200 entries) of fields to create. Every entry needs type (text, checkbox, radio, dropdown or signature), name (1-200 characters, no dot, unique, also against fields already in the PDF) and page (1-based). Every type except radio also needs x, y, width and height in PDF points from the bottom-left of the page as displayed; the box must lie inside the page. Optional on all types: required, read_only, border, background. text takes multiline, max_length, default, font_size (1-200 or "auto"); checkbox takes checked; radio takes options[] of { value, x, y, width, height } and default; dropdown takes options[] of strings, default, font_size.',
				displayOptions: { show: { operation: ['addFields'] } },
			},
			{
				displayName: 'Files to Attach',
				name: 'attachments',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				placeholder: 'Add File',
				default: {},
				required: true,
				description:
					'Files to embed, in order (1 to 10, up to 3 MB combined). Each one is read from a binary field of the input item.',
				displayOptions: { show: { operation: ['attach'] } },
				options: [
					{
						displayName: 'File',
						name: 'file',
						values: [
							{
								displayName: 'Binary Field',
								name: 'binaryPropertyName',
								type: 'string',
								default: 'attachment',
								required: true,
								description: 'The name of the input item’s binary field holding the file to embed',
							},
							{
								displayName: 'Description',
								name: 'description',
								type: 'string',
								default: '',
								description: 'Free text description stored with the file (optional)',
							},
							{
								displayName: 'MIME Type',
								name: 'mimeType',
								type: 'string',
								default: '',
								placeholder: 'e.g. text/xml',
								description: 'Defaults to the MIME type of the binary data',
							},
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
								placeholder: 'e.g. factur-x.xml',
								description:
									'File name inside the PDF (1-255 characters, no / or \\). Defaults to the binary data’s file name. Must be unique within the PDF.',
							},
							{
								displayName: 'Relationship',
								name: 'relationship',
								type: 'options',
								options: [
									{ name: 'Alternative', value: 'Alternative' },
									{ name: 'Data', value: 'Data' },
									{ name: 'Source', value: 'Source' },
									{ name: 'Supplement', value: 'Supplement' },
									{ name: 'Unspecified', value: 'Unspecified' },
								],
								default: 'Unspecified',
								description: 'PDF/A-3 relationship of the file to the document',
							},
						],
					},
				],
			},
			{
				displayName: 'Items',
				name: 'editItems',
				type: 'json',
				default:
					'[\n  { "type": "text", "page": 1, "x": 72, "y": 720, "text": "Approved", "size": 14 }\n]',
				required: true,
				description:
					'JSON array (up to 100 entries) of things to draw, in order (later ones draw on top). x and y are PDF points from the bottom-left of the page as displayed. type "text": page, x, y, text (WinAnsi characters only), optional size, color, font, opacity, rotation, maxWidth, lineHeight. type "image": page, x, y, image (the Field Name of one of the Image Files below), optional width, height, opacity. type "barcode": page, x, y, format (qrcode, datamatrix, pdf417, azteccode, code128, code39, ean13, ean8, upca, itf14, interleaved2of5, gs1-128), value, optional width, height, color, background, includeText, errorCorrection, opacity.',
				displayOptions: { show: { operation: ['edit'] } },
			},
			{
				displayName: 'Image Files',
				name: 'imageFiles',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				placeholder: 'Add Image',
				default: {},
				description:
					'PNG or JPEG images that "image" items refer to (up to 10, 2 MB each). Only needed when Items contains image entries.',
				displayOptions: { show: { operation: ['edit'] } },
				options: [
					{
						displayName: 'Image',
						name: 'image',
						values: [
							{
								displayName: 'Binary Field',
								name: 'binaryPropertyName',
								type: 'string',
								default: 'logo',
								required: true,
								description: 'The name of the input item’s binary field holding the PNG or JPEG',
							},
							{
								displayName: 'Field Name',
								name: 'fieldName',
								type: 'string',
								default: 'logo',
								required: true,
								description:
									'The name an Items entry uses in its "image" property to refer to this file. Must not be pdf, password or items.',
							},
						],
					},
				],
			},
			{
				displayName: 'Query',
				name: 'query',
				type: 'string',
				default: '',
				required: true,
				description:
					'Text to find, or a regular expression when the Regex option is on. A match never spans two lines. Regex uses a safe subset of JavaScript syntax: backreferences, lookahead, lookbehind, named groups and inline flags are rejected.',
				displayOptions: { show: { operation: ['findText'] } },
			},
			{
				displayName: 'Find Options',
				name: 'findOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { operation: ['findText'] } },
				options: [
					{
						displayName: 'Case Sensitive',
						name: 'case_sensitive',
						type: 'boolean',
						default: false,
						description: 'Whether upper and lower case must match (off by default)',
					},
					{
						displayName: 'Max Hits',
						name: 'max_hits',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 1000 },
						default: 100,
						description:
							'Most hits to return (1-1000). When the result has truncated true and nextPage is not null, the search stopped early: run it again with the same Query and options and Pages set to nextPage followed by a dash (for example 4-), keeping any page filter you used before and dropping pages below nextPage. No hit is repeated. Check pagesSkipped on every response: a page listed there held more hits than Max Hits (or was too large), only its first hits were returned, and no later request returns the rest, so raise Max Hits or narrow the Query for that page.',
					},
					{
						displayName: 'Regex',
						name: 'regex',
						type: 'boolean',
						default: false,
						description: 'Whether the Query is a regular expression instead of literal text',
					},
					{
						displayName: 'Whole Word',
						name: 'whole_word',
						type: 'boolean',
						default: false,
						description: 'Whether a hit must not touch a letter, digit or underscore on either side',
					},
				],
			},
			{
				displayName: 'Result Format',
				name: 'textFormat',
				type: 'options',
				options: [
					{
						name: 'JSON (Pages, Lines and Tables)',
						value: 'json',
						description:
							'Returns pageCount, pages[] (text, lines with positions, tables as rows), pagesWithoutText and truncated',
					},
					{
						name: 'Plain Text',
						value: 'text',
						description: 'The text of all pages in the item JSON field "text", pages separated by a form feed',
					},
				],
				default: 'json',
				displayOptions: { show: { operation: ['extractText'] } },
			},
			{
				displayName: 'Tables As',
				name: 'tablesFormat',
				type: 'options',
				options: [
					{
						name: 'CSV (Added to Each Table in the JSON)',
						value: 'csv',
						description: 'Each table also carries a "csv" string (RFC 4180); rows is unchanged',
					},
					{
						name: 'Excel Workbook (Binary Output)',
						value: 'xlsx',
						description:
							'Returns one .xlsx workbook as binary data instead of JSON: one sheet per table, every cell text. Fails with no_tables when the selected pages hold no table.',
					},
					{
						name: 'JSON Rows',
						value: 'json',
						description: 'Tables as rows of cells in the JSON',
					},
				],
				default: 'json',
				displayOptions: { show: { operation: ['extractText'], textFormat: ['json'] } },
			},
			{
				displayName: 'HTML',
				name: 'html',
				type: 'string',
				typeOptions: { rows: 8 },
				default: '<h1>Hello</h1>\n<p>Rendered by PDFops.</p>',
				required: true,
				description:
					'The HTML document to render, up to 1 MB. Text only: there is no URL input and JavaScript is switched off. External images, stylesheets and fonts load over https from public hosts only; data: URIs are the safest way to include images.',
				displayOptions: { show: { operation: ['htmlToPdf'] } },
			},
			{
				displayName: 'HTML Options',
				name: 'htmlOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { operation: ['htmlToPdf'] } },
				options: [
					{
						displayName: 'Landscape',
						name: 'landscape',
						type: 'boolean',
						default: false,
						description: 'Whether to lay the pages out in landscape',
					},
					{
						displayName: 'Margin',
						name: 'margin',
						type: 'number',
						typeOptions: { minValue: 0, maxValue: 144 },
						default: 36,
						description: 'Page margin in points on all four sides (0-144)',
					},
					{
						displayName: 'Page Size',
						name: 'page_size',
						type: 'options',
						options: [
							{ name: 'A4', value: 'a4' },
							{ name: 'Letter', value: 'letter' },
						],
						default: 'letter',
					},
					{
						displayName: 'Print Background',
						name: 'print_background',
						type: 'boolean',
						default: true,
						description: 'Whether to print CSS backgrounds and background images',
					},
					{
						displayName: 'Scale',
						name: 'scale',
						type: 'number',
						typeOptions: { minValue: 0.1, maxValue: 2, numberPrecision: 2 },
						default: 1,
						description: 'Rendering scale from 0.1 to 2',
					},
				],
			},
			{
				displayName: 'Content',
				name: 'content',
				type: 'string',
				typeOptions: { rows: 8 },
				default: '',
				required: true,
				description:
					'The document, up to 512 KiB of UTF-8. Latin (WinAnsi) characters only; other scripts are rejected with the character and its line and column named. Not HTML: use HTML to PDF for that.',
				displayOptions: { show: { operation: ['textToPdf'] } },
			},
			{
				displayName: 'Text Options',
				name: 'textOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { operation: ['textToPdf'] } },
				options: [
					{
						displayName: 'Font Size',
						name: 'font_size',
						type: 'number',
						typeOptions: { minValue: 6, maxValue: 36 },
						default: 11,
						description: 'Body text size in points (6-36)',
					},
					{
						displayName: 'Format',
						name: 'format',
						type: 'options',
						options: [
							{
								name: 'CSV',
								value: 'csv',
								description: 'A table whose first row is the header',
							},
							{
								name: 'Markdown',
								value: 'markdown',
								description: 'Headings, lists, tables, code blocks and links',
							},
							{
								name: 'Plain Text',
								value: 'text',
								description: 'Spaces and line breaks kept exactly',
							},
						],
						default: 'markdown',
					},
					{
						displayName: 'Margin',
						name: 'margin',
						type: 'number',
						typeOptions: { minValue: 18, maxValue: 144 },
						default: 54,
						description: 'Page margin in points on all four sides (18-144)',
					},
					{
						displayName: 'Monospace',
						name: 'monospace',
						type: 'boolean',
						default: false,
						description: 'Whether to set plain text in Courier (Plain Text format only)',
					},
					{
						displayName: 'Page Numbers',
						name: 'page_numbers',
						type: 'boolean',
						default: false,
						description: 'Whether to print "Page n of N" in the bottom margin',
					},
					{
						displayName: 'Page Size',
						name: 'page_size',
						type: 'options',
						options: [
							{ name: 'A4', value: 'a4' },
							{ name: 'Letter', value: 'letter' },
						],
						default: 'letter',
					},
					{
						displayName: 'Title',
						name: 'title',
						type: 'string',
						default: '',
						description: 'PDF title metadata, up to 200 characters. Not printed on the page.',
					},
				],
			},
			{
				displayName: 'Image Options',
				name: 'imageOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { operation: ['imageToPdf'] } },
				options: [
					{
						displayName: 'Margin',
						name: 'margin',
						type: 'number',
						typeOptions: { minValue: 0, maxValue: 200 },
						default: 0,
						description:
							'Margin in points (0-200). The API default is 0 for Fit to Image and 36 for A4 and Letter; for Fit to Image the page grows by the margin on each side.',
					},
					{
						displayName: 'Orientation',
						name: 'orientation',
						type: 'options',
						options: [
							{ name: 'Auto (Per Image)', value: 'auto' },
							{ name: 'Landscape', value: 'landscape' },
							{ name: 'Portrait', value: 'portrait' },
						],
						default: 'auto',
						description: 'Ignored for Fit to Image',
					},
					{
						displayName: 'Page Size',
						name: 'page_size',
						type: 'options',
						options: [
							{ name: 'A4', value: 'a4' },
							{ name: 'Fit to Image', value: 'fit' },
							{ name: 'Letter', value: 'letter' },
						],
						default: 'fit',
						description:
							'Fit to Image makes each page the size of its image; A4 and Letter scale images down to fit, never up',
					},
				],
			},
			{
				displayName: 'Invoice',
				name: 'invoice',
				type: 'json',
				default:
					'{\n  "from": "Acme Inc",\n  "to": "Customer LLC",\n  "items": [\n    { "description": "Consulting", "quantity": 2, "unit_price": 100 }\n  ]\n}',
				required: true,
				description:
					'Invoice data: from, to, items[] (description, quantity?, unit_price), and optionally invoice_number, date, due, currency, tax_rate, notes. Deterministic: the same input produces a byte-identical PDF. For a Factur-X e-invoice (node version 2), from and to also take country, street, postcode, city, vat_id (and from.tax_id with registration_id), and every item needs a unit.',
				displayOptions: {
					show: {
						operation: ['invoice'],
					},
				},
			},
			{
				displayName: 'Factur-X E-Invoice',
				name: 'eInvoice',
				type: 'boolean',
				default: false,
				description:
					'Whether to produce a Factur-X (ZUGFeRD) e-invoice: a PDF/A-3 with the invoice data embedded as factur-x.xml, profile EN 16931. Required in the Invoice JSON then: invoice_number, date (YYYY-MM-DD), currency, due or payment_terms, from.country and to.country (ISO 3166-1 alpha-2), from.vat_id (or from.tax_id with from.registration_id; with tax category O, no VAT ID at all and from.registration_id instead), a buyer to.vat_id or to.registration_id for tax category AE, a UN/ECE Recommendation 20 unit on every item (C62 one, HUR hour, KGM kilogram), and tax_category when tax_rate is 0. Text is limited to Latin letters, Latin Extended-A, the euro sign and common punctuation. Tested with the Mustang validator; this is not a statement of legal compliance, and XRechnung and Peppol output are not produced.',
				displayOptions: { show: { '@version': [2], operation: ['invoice'] } },
			},
			{
				displayName: 'E-Invoice Options',
				name: 'eInvoiceOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { '@version': [2], operation: ['invoice'], eInvoice: [true] } },
				options: [
					{
						displayName: 'IBAN',
						name: 'iban',
						type: 'string',
						default: '',
						description: 'Seller bank account for the payment instructions (spaces are ignored)',
					},
					{
						displayName: 'Payment Terms',
						name: 'payment_terms',
						type: 'string',
						default: '',
						description: 'Payment terms text. Either this or a due date in the Invoice JSON is required.',
					},
					{
						displayName: 'Tax Category',
						name: 'tax_category',
						type: 'options',
						options: [
							{ name: 'Exempt (E)', value: 'E' },
							{ name: 'Not Subject to VAT (O)', value: 'O' },
							{ name: 'Reverse Charge (AE)', value: 'AE' },
							{ name: 'Standard Rate (S)', value: 'S' },
							{ name: 'Zero Rate (Z)', value: 'Z' },
						],
						default: 'S',
						description:
							'EN 16931 VAT category for the whole invoice. S is the default when tax_rate is above 0; required when tax_rate is 0 or missing.',
					},
					{
						displayName: 'Tax Exemption Reason',
						name: 'tax_exemption_reason',
						type: 'string',
						default: '',
						description: 'Reason text, required for the Exempt, Reverse Charge and Not Subject to VAT categories',
					},
				],
			},
			{
				displayName: 'Flatten',
				name: 'flatten',
				type: 'boolean',
				default: false,
				description:
					'Whether to bake the filled values into the page so the fields are no longer interactive — useful for locking a form before sending or archiving. Off by default (the output stays an editable AcroForm).',
				displayOptions: {
					show: {
						operation: ['fill'],
					},
				},
			},
			{
				displayName: 'Output Binary Field',
				name: 'outputBinaryPropertyName',
				type: 'string',
				default: 'data',
				hint: 'The name of the output item’s binary field to write the resulting PDF to',
				displayOptions: {
					show: {
						operation: ['fill', 'merge', 'invoice', 'extractPages', 'deletePages', 'rotate', 'split', 'watermark', 'pageNumbers', 'unlock', 'protect', 'setMetadata', 'addFields', 'attach', 'edit', 'htmlToPdf', 'imageToPdf', 'textToPdf'],
					},
				},
			},
			{
				displayName: 'Output File Name',
				name: 'fileName',
				type: 'string',
				default: '',
				placeholder: 'e.g. filled.pdf',
				description:
					'File name for the output PDF. Defaults per operation. For Split PDF it is the prefix: parts are named prefix-1.pdf, prefix-2.pdf and so on',
				displayOptions: {
					show: {
						operation: ['fill', 'merge', 'invoice', 'extractPages', 'deletePages', 'rotate', 'split', 'watermark', 'pageNumbers', 'unlock', 'protect', 'setMetadata', 'addFields', 'attach', 'edit', 'htmlToPdf', 'imageToPdf', 'textToPdf'],
					},
				},
			},
			{
				displayName: 'Output Binary Field',
				name: 'outputBinaryPropertyName',
				type: 'string',
				default: 'data',
				hint: 'The name of the output item’s binary field to write the Excel workbook to',
				displayOptions: {
					show: { operation: ['extractText'], textFormat: ['json'], tablesFormat: ['xlsx'] },
				},
			},
			{
				displayName: 'Output File Name',
				name: 'fileName',
				type: 'string',
				default: 'tables.xlsx',
				placeholder: 'e.g. tables.xlsx',
				description: 'File name for the output Excel workbook',
				displayOptions: {
					show: { operation: ['extractText'], textFormat: ['json'], tablesFormat: ['xlsx'] },
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const operation = this.getNodeParameter('operation', 0) as string;

		// A selected credential that fails to load must error, not silently go keyless.
		const hasCredential = !!this.getNode().credentials?.pdfopsApi?.id;

		const request = async (options: IHttpRequestOptions): Promise<unknown> => {
			options.headers = {
				...options.headers,
				'X-Pdfops-Client': 'n8n',
				'X-Pdfops-Client-Version': NODE_PACKAGE_VERSION,
			};
			// Never follow a redirect: n8n would forward the credential header to another origin.
			options.disableFollowRedirect = true;
			if (hasCredential) {
				return await this.helpers.httpRequestWithAuthentication.call(this, 'pdfopsApi', options);
			}
			return await this.helpers.httpRequest(options);
		};

		const jsonParam = (name: string, itemIndex: number): IDataObject => {
			const raw = this.getNodeParameter(name, itemIndex);
			let value: unknown = raw;
			if (typeof raw === 'string') {
				try {
					value = JSON.parse(raw);
				} catch {
					throw new NodeOperationError(this.getNode(), `Parameter "${name}" is not valid JSON`, {
						itemIndex,
					});
				}
			}
			if (value === null || typeof value !== 'object' || Array.isArray(value)) {
				throw new NodeOperationError(
					this.getNode(),
					`Parameter "${name}" must be a JSON object`,
					{ itemIndex },
				);
			}
			return value as IDataObject;
		};

		const jsonArrayParam = (name: string, itemIndex: number): unknown[] => {
			const raw = this.getNodeParameter(name, itemIndex);
			let value: unknown = raw;
			if (typeof raw === 'string') {
				try {
					value = JSON.parse(raw);
				} catch {
					throw new NodeOperationError(this.getNode(), `Parameter "${name}" is not valid JSON`, {
						itemIndex,
					});
				}
			}
			if (!Array.isArray(value)) {
				throw new NodeOperationError(this.getNode(), `Parameter "${name}" must be a JSON array`, {
					itemIndex,
				});
			}
			return value;
		};

		const pdfBlob = async (itemIndex: number, binaryPropertyName: string): Promise<Blob> => {
			this.helpers.assertBinaryData(itemIndex, binaryPropertyName);
			const buffer = await this.helpers.getBinaryDataBuffer(itemIndex, binaryPropertyName);
			return new Blob([new Uint8Array(buffer)], { type: 'application/pdf' });
		};

		// Any binary field as a Blob, for the files that are not PDFs (attachments, images).
		const fileBlob = async (
			itemIndex: number,
			binaryPropertyName: string,
			mimeType?: string,
		): Promise<{ blob: Blob; fileName: string }> => {
			const meta = this.helpers.assertBinaryData(itemIndex, binaryPropertyName);
			const buffer = await this.helpers.getBinaryDataBuffer(itemIndex, binaryPropertyName);
			return {
				blob: new Blob([new Uint8Array(buffer)], {
					type: mimeType || meta.mimeType || 'application/octet-stream',
				}),
				fileName: meta.fileName || binaryPropertyName,
			};
		};

		// Merge consumes ALL incoming items at once and emits a single item.
		if (operation === 'merge') {
			const binaryPropertyName = this.getNodeParameter('binaryPropertyName', 0) as string;
			const fileName = (this.getNodeParameter('fileName', 0) as string) || 'merged.pdf';
			const outputBinaryPropertyName = this.getNodeParameter(
				'outputBinaryPropertyName',
				0,
			) as string;
			const formData = new FormData();
			try {
				for (let i = 0; i < items.length; i++) {
					formData.append('pdf', await pdfBlob(i, binaryPropertyName), `input-${i}.pdf`);
				}
				const mergePassword = this.getNodeParameter('password', 0) as string;
				if (mergePassword) formData.append('password', mergePassword);
				const response = (await request({
					method: 'POST',
					url: `${BASE_URL}/api/merge`,
					body: formData,
					encoding: 'arraybuffer',
				})) as Buffer;
				returnData.push({
					json: { fileName, mergedCount: items.length },
					binary: {
						[outputBinaryPropertyName]: await this.helpers.prepareBinaryData(
							response,
							fileName,
							'application/pdf',
						),
					},
					pairedItem: items.map((_, i) => ({ item: i })),
				});
			} catch (error) {
				const apiError = decodeApiError(error);
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: apiError?.message ?? (error as Error).message,
							...(apiError?.details ? { message: apiError.details } : {}),
						},
						pairedItem: { item: 0 },
					});
				} else {
					throw withApiMessage(new NodeApiError(this.getNode(), error as JsonObject), apiError);
				}
			}
			return [returnData];
		}

		// Images to PDF also consumes ALL incoming items at once (one image each) and emits a single item.
		if (operation === 'imageToPdf') {
			const formData = new FormData();
			try {
				const binaryPropertyName = this.getNodeParameter('binaryPropertyName', 0) as string;
				const fileName = (this.getNodeParameter('fileName', 0) as string) || 'images.pdf';
				const outputBinaryPropertyName = this.getNodeParameter(
					'outputBinaryPropertyName',
					0,
				) as string;
				for (let i = 0; i < items.length; i++) {
					const image = await fileBlob(i, binaryPropertyName);
					formData.append('pdf', image.blob, image.fileName);
				}
				const imageOptions = this.getNodeParameter('imageOptions', 0, {}) as IDataObject;
				for (const [k, v] of Object.entries(imageOptions)) {
					if (v !== undefined && v !== null && v !== '') formData.append(k, String(v));
				}
				const response = (await request({
					method: 'POST',
					url: `${BASE_URL}/api/image-to-pdf`,
					body: formData,
					encoding: 'arraybuffer',
				})) as Buffer;
				returnData.push({
					json: { fileName, imageCount: items.length },
					binary: {
						[outputBinaryPropertyName]: await this.helpers.prepareBinaryData(
							response,
							fileName,
							'application/pdf',
						),
					},
					pairedItem: items.map((_, i) => ({ item: i })),
				});
			} catch (error) {
				const apiError = decodeApiError(error);
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: apiError?.message ?? (error as Error).message,
							...(apiError?.details ? { message: apiError.details } : {}),
						},
						pairedItem: items.map((_, i) => ({ item: i })),
					});
				} else {
					throw withApiMessage(new NodeApiError(this.getNode(), error as JsonObject), apiError);
				}
			}
			return [returnData];
		}

		if (operation === 'usage' && !hasCredential) {
			throw new NodeOperationError(
				this.getNode(),
				'The Get Usage operation requires a PDFops API credential (free key at https://pdfops.dev/pricing)',
			);
		}

		for (let i = 0; i < items.length; i++) {
			let options: IHttpRequestOptions;
			let binaryOut: { fileName: string; property: string; mimeType?: string } | undefined;
			let splitOut = false;
			let textOut = false;

			try {
				if (operation === 'inspect') {
					const formData = new FormData();
					formData.append(
						'pdf',
						await pdfBlob(i, this.getNodeParameter('binaryPropertyName', i) as string),
						'input.pdf',
					);
					const inspectPassword = this.getNodeParameter('password', i) as string;
					if (inspectPassword) formData.append('password', inspectPassword);
					options = { method: 'POST', url: `${BASE_URL}/api/inspect`, body: formData, json: true };
				} else if (operation === 'fill') {
					const formData = new FormData();
					formData.append(
						'pdf',
						await pdfBlob(i, this.getNodeParameter('binaryPropertyName', i) as string),
						'input.pdf',
					);
					formData.append('fields', JSON.stringify(jsonParam('fields', i)));
					if (this.getNodeParameter('flatten', i) as boolean) {
						formData.append('flatten', 'true');
					}
					const fillPassword = this.getNodeParameter('password', i) as string;
					if (fillPassword) formData.append('password', fillPassword);
					options = {
						method: 'POST',
						url: `${BASE_URL}/api/fill-form`,
						body: formData,
						encoding: 'arraybuffer',
					};
					binaryOut = {
						fileName: (this.getNodeParameter('fileName', i) as string) || 'filled.pdf',
						property: this.getNodeParameter('outputBinaryPropertyName', i) as string,
					};
				} else if (operation === 'invoice') {
					const invoiceBody: IDataObject = { ...jsonParam('invoice', i) };
					if (this.getNodeParameter('eInvoice', i, false) as boolean) {
						invoiceBody.e_invoice = 'factur-x';
						const eInvoiceOptions = this.getNodeParameter('eInvoiceOptions', i, {}) as IDataObject;
						for (const [k, v] of Object.entries(eInvoiceOptions)) {
							if (v !== undefined && v !== null && v !== '') invoiceBody[k] = v;
						}
					}
					options = {
						method: 'POST',
						url: `${BASE_URL}/api/invoice`,
						body: invoiceBody,
						json: true,
						encoding: 'arraybuffer',
					};
					binaryOut = {
						fileName: (this.getNodeParameter('fileName', i) as string) || 'invoice.pdf',
						property: this.getNodeParameter('outputBinaryPropertyName', i) as string,
					};
				} else if (operation === 'htmlToPdf' || operation === 'textToPdf') {
					const isHtml = operation === 'htmlToPdf';
					const body: IDataObject = isHtml
						? { html: this.getNodeParameter('html', i) as string }
						: { content: this.getNodeParameter('content', i) as string };
					const extra = this.getNodeParameter(
						isHtml ? 'htmlOptions' : 'textOptions',
						i,
						{},
					) as IDataObject;
					for (const [k, v] of Object.entries(extra)) {
						if (v !== undefined && v !== null && v !== '') body[k] = v;
					}
					options = {
						method: 'POST',
						url: `${BASE_URL}/api/${isHtml ? 'html-to-pdf' : 'text-to-pdf'}`,
						body,
						json: true,
						encoding: 'arraybuffer',
					};
					binaryOut = {
						fileName: (this.getNodeParameter('fileName', i) as string) || 'document.pdf',
						property: this.getNodeParameter('outputBinaryPropertyName', i) as string,
					};
				} else if (DOC_OPS[operation]) {
					const spec = DOC_OPS[operation];
					const formData = new FormData();
					formData.append(
						'pdf',
						await pdfBlob(i, this.getNodeParameter('binaryPropertyName', i) as string),
						'input.pdf',
					);
					const add = (name: string, value: unknown) => {
						if (value !== undefined && value !== null && value !== '') {
							formData.append(name, String(value));
						}
					};
					add('password', this.getNodeParameter('password', i));
					const collection = (name: string) => this.getNodeParameter(name, i, {}) as IDataObject;
					if (operation === 'extractPages' || operation === 'deletePages') {
						add('pages', this.getNodeParameter('pages', i));
					} else if (operation === 'rotate') {
						add('degrees', this.getNodeParameter('degrees', i));
						add('pages', this.getNodeParameter('pages', i));
					} else if (operation === 'split') {
						const mode = this.getNodeParameter('splitMode', i) as string;
						add(mode, this.getNodeParameter(mode, i));
					} else if (operation === 'watermark') {
						add('text', this.getNodeParameter('text', i));
						add('pages', this.getNodeParameter('pages', i));
						for (const [k, v] of Object.entries(collection('watermarkOptions'))) add(k, v);
					} else if (operation === 'pageNumbers') {
						add('pages', this.getNodeParameter('pages', i));
						for (const [k, v] of Object.entries(collection('pageNumberOptions'))) add(k, v);
					} else if (operation === 'protect') {
						add('user_password', this.getNodeParameter('userPassword', i));
						add('owner_password', this.getNodeParameter('ownerPassword', i));
						const { permissions } = collection('protectOptions');
						// An empty list is meaningful (allow nothing), so send it as an empty value.
						if (Array.isArray(permissions)) formData.append('permissions', permissions.join(','));
					} else if (operation === 'setMetadata') {
						for (const [k, v] of Object.entries(collection('metadataFields'))) {
							// An empty string is meaningful here (clears the field).
							formData.append(k, String(v ?? ''));
						}
					} else if (operation === 'addFields') {
						formData.append('fields', JSON.stringify(jsonArrayParam('formFields', i)));
					} else if (operation === 'edit') {
						formData.append('items', JSON.stringify(jsonArrayParam('editItems', i)));
						const images = (
							this.getNodeParameter('imageFiles', i, {}) as {
								image?: Array<{ binaryPropertyName: string; fieldName: string }>;
							}
						).image;
						const seenImageNames = new Set<string>();
						for (const image of images ?? []) {
							if (!/^[A-Za-z0-9_.-]{1,64}$/.test(image.fieldName ?? '')) {
								throw new NodeOperationError(
									this.getNode(),
									`Image field name "${image.fieldName ?? ''}" is not allowed: use 1-64 letters, digits, "_", "." or "-"`,
									{ itemIndex: i },
								);
							}
							if (['pdf', 'password', 'items'].includes(image.fieldName)) {
								throw new NodeOperationError(
									this.getNode(),
									`Image field name "${image.fieldName}" is reserved; use another name`,
									{ itemIndex: i },
								);
							}
							if (seenImageNames.has(image.fieldName)) {
								throw new NodeOperationError(
									this.getNode(),
									`Image field name "${image.fieldName}" is used twice; each image needs its own name`,
									{ itemIndex: i },
								);
							}
							seenImageNames.add(image.fieldName);
							const file = await fileBlob(i, image.binaryPropertyName);
							formData.append(image.fieldName, file.blob, file.fileName);
						}
					} else if (operation === 'attach') {
						const files = (
							this.getNodeParameter('attachments', i, {}) as {
								file?: Array<{
									binaryPropertyName: string;
									name?: string;
									mimeType?: string;
									description?: string;
									relationship?: string;
								}>;
							}
						).file;
						if (!files?.length) {
							throw new NodeOperationError(this.getNode(), 'Add at least one file to attach', {
								itemIndex: i,
							});
						}
						const perFile: Array<Record<string, string>> = [];
						for (const f of files) {
							const file = await fileBlob(i, f.binaryPropertyName, f.mimeType);
							const name = f.name || file.fileName;
							formData.append('file', file.blob, name);
							const entry: Record<string, string> = { name };
							if (f.mimeType) entry.mime_type = f.mimeType;
							if (f.description) entry.description = f.description;
							if (f.relationship) entry.relationship = f.relationship;
							perFile.push(entry);
						}
						formData.append('options', JSON.stringify(perFile));
					} else if (operation === 'findText') {
						add('query', this.getNodeParameter('query', i));
						add('pages', this.getNodeParameter('pages', i));
						for (const [k, v] of Object.entries(collection('findOptions'))) add(k, v);
					} else if (operation === 'extractText') {
						add('pages', this.getNodeParameter('pages', i));
					}
					if (spec.output === 'extract') {
						// tables_format=xlsx returns a workbook and needs format=json (the API's own rule).
						const format = this.getNodeParameter('textFormat', i) as string;
						const tablesFormat =
							format === 'json' ? (this.getNodeParameter('tablesFormat', i) as string) : 'json';
						if (format === 'text') formData.append('format', 'text');
						if (tablesFormat !== 'json') formData.append('tables_format', tablesFormat);
						if (tablesFormat === 'xlsx') {
							options = {
								method: 'POST',
								url: `${BASE_URL}/api/${spec.path}`,
								body: formData,
								encoding: 'arraybuffer',
							};
							binaryOut = {
								fileName: (this.getNodeParameter('fileName', i) as string) || spec.defaultFile,
								property: this.getNodeParameter('outputBinaryPropertyName', i) as string,
								mimeType: XLSX_MIME_TYPE,
							};
						} else if (format === 'text') {
							textOut = true;
							options = {
								method: 'POST',
								url: `${BASE_URL}/api/${spec.path}`,
								body: formData,
								encoding: 'text',
							};
						} else {
							options = {
								method: 'POST',
								url: `${BASE_URL}/api/${spec.path}`,
								body: formData,
								json: true,
							};
						}
					} else if (spec.output === 'pdf') {
						options = {
							method: 'POST',
							url: `${BASE_URL}/api/${spec.path}`,
							body: formData,
							encoding: 'arraybuffer',
						};
						binaryOut = {
							fileName: (this.getNodeParameter('fileName', i) as string) || spec.defaultFile,
							property: this.getNodeParameter('outputBinaryPropertyName', i) as string,
						};
					} else {
						options = {
							method: 'POST',
							url: `${BASE_URL}/api/${spec.path}`,
							body: formData,
							json: true,
						};
						if (spec.output === 'parts') {
							splitOut = true;
							binaryOut = {
								fileName: (
									(this.getNodeParameter('fileName', i) as string) || spec.defaultFile
								).replace(/\.pdf$/i, ''),
								property: this.getNodeParameter('outputBinaryPropertyName', i) as string,
							};
						}
					}
				} else if (operation === 'usage') {
					options = { method: 'GET', url: `${BASE_URL}/api/usage`, json: true };
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown operation "${operation}"`, {
						itemIndex: i,
					});
				}
			} catch (error) {
				// One bad item must not throw away the items already done this run.
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}

			try {
				if ((binaryOut && !splitOut) || textOut) options.returnFullResponse = true;
				const response = await request(options);
				if (splitOut && binaryOut) {
					const parts = (
						response as { parts?: Array<{ pages: string; page_count: number; pdf: string }> }
					).parts;
					if (!Array.isArray(parts)) {
						throw new NodeOperationError(this.getNode(), 'Unexpected split response: no parts', {
							itemIndex: i,
						});
					}
					for (let n = 0; n < parts.length; n++) {
						const name = `${binaryOut.fileName}-${n + 1}.pdf`;
						returnData.push({
							json: { pages: parts[n].pages, page_count: parts[n].page_count, part: n + 1 },
							binary: {
								[binaryOut.property]: await this.helpers.prepareBinaryData(
									Buffer.from(parts[n].pdf, 'base64'),
									name,
									'application/pdf',
								),
							},
							pairedItem: { item: i },
						});
					}
				} else if (textOut) {
					const full = response as { body: string; headers?: Record<string, string> };
					returnData.push({
						json: {
							text: full.body,
							truncated: headerTrue(full.headers?.['x-pdfops-truncated']),
						},
						pairedItem: { item: i },
					});
				} else if (binaryOut) {
					const full = response as { body: Buffer; headers?: Record<string, string> };
					const json: IDataObject = { fileName: binaryOut.fileName };
					// Fill Form: forgiving key matching reports what it resolved (non-exact keys only).
					const fieldMap = full.headers?.['x-pdfops-field-map'];
					if (fieldMap) {
						try {
							json.field_map = JSON.parse(fieldMap) as IDataObject;
						} catch {
							json.field_map = fieldMap;
						}
					}
					const note = full.headers?.['x-pdfops-note'];
					if (note) json.note = note;
					if (operation === 'attach') {
						// The lookup key of each embedded file, in request order; only well-formed entries.
						let keys: IDataObject[] = [];
						try {
							const parsed: unknown = JSON.parse(String(full.headers?.['x-pdfops-attachment-keys']));
							if (Array.isArray(parsed)) {
								keys = parsed
									.filter(
										(e): e is { name: string; key: string } =>
											typeof e?.name === 'string' && typeof e?.key === 'string',
									)
									.map((e) => ({ name: e.name, key: e.key }));
							}
						} catch {
							keys = [];
						}
						json.attachment_keys = keys;
					}
					if (operation === 'extractText') {
						// The workbook read stopped early or a cell was cut.
						if (headerTrue(full.headers?.['x-pdfops-truncated'])) {
							json.truncated = true;
							const truncatedBy = full.headers?.['x-pdfops-truncated-by'];
							if (typeof truncatedBy === 'string' && truncatedBy) {
								json.truncated_by = truncatedBy.split(',');
							}
						}
						if (headerTrue(full.headers?.['x-pdfops-cells-truncated'])) json.cells_truncated = true;
						const body = Buffer.from(full.body);
						if (body.length < 4 || body.readUInt32BE(0) !== 0x504b0304) {
							throw new NodeOperationError(
								this.getNode(),
								'The API did not return an Excel workbook (the response is not a zip file)',
								{ itemIndex: i },
							);
						}
					}
					if (operation === 'addFields') {
						const warning = full.headers?.['x-pdfops-warning'];
						if (typeof warning === 'string' && warning) json.warning = warning;
					}
					if (operation === 'htmlToPdf') {
						for (const [header, key] of [
							['x-pdfops-pages', 'pages'],
							['x-pdfops-blocked-requests', 'blocked_requests'],
						] as const) {
							const value = full.headers?.[header];
							if (typeof value === 'string' && /^\d+$/.test(value)) json[key] = Number(value);
						}
					}
					returnData.push({
						json,
						binary: {
							[binaryOut.property]: await this.helpers.prepareBinaryData(
								full.body,
								binaryOut.fileName,
								binaryOut.mimeType ?? 'application/pdf',
							),
						},
						pairedItem: { item: i },
					});
				} else {
					returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
				}
			} catch (error) {
				// PDF-producing calls set encoding:'arraybuffer', so a 4xx body arrives
				// as a Buffer and NodeApiError can only report "Request failed with
				// status code 400". The API already names the offending field, so decode
				// it — a mistyped AcroForm field name is the dominant user error here.
				const apiError = decodeApiError(error);
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: apiError?.message ?? (error as Error).message,
							...(apiError?.details ? { message: apiError.details } : {}),
						},
						pairedItem: { item: i },
					});
					continue;
				}
				throw withApiMessage(
					new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i }),
					apiError,
					i,
				);
			}
		}

		return [returnData];
	}
}
