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
const NODE_PACKAGE_VERSION = '0.4.0';

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
const DOC_OPS: Record<string, { path: string; output: 'pdf' | 'json' | 'parts'; defaultFile: string }> = {
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
};

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
			{ name: 'Document', value: 'document' },
			{ name: 'Form', value: 'form' },
			{ name: 'Invoice', value: 'invoice' },
			{ name: 'Metadata', value: 'metadata' },
			{ name: 'Security', value: 'security' },
			{ name: 'Stamp', value: 'stamp' },
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
		],
		default: 'watermark',
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
			'Fill, merge, split, rotate, watermark, number, protect, unlock and read PDFs and generate invoices. Works without an API key (100 calls/month).',
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
						operation: ['fill', 'inspect', 'merge', 'extractPages', 'deletePages', 'rotate', 'split', 'watermark', 'pageNumbers', 'unlock', 'protect', 'metadata', 'setMetadata'],
					},
				},
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
				displayOptions: { show: { operation: ['rotate', 'watermark', 'pageNumbers'] } },
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
					'Password required to open the output PDF (at most 128 characters). Set this and/or the Owner Password; at least one is required.',
				displayOptions: { show: { operation: ['protect'] } },
			},
			{
				displayName: 'Owner Password',
				name: 'ownerPassword',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				description:
					'Password that lifts the permission restrictions (at most 128 characters). Restrictions only bind a viewer when an owner password is set.',
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
				displayName: 'Invoice',
				name: 'invoice',
				type: 'json',
				default:
					'{\n  "from": "Acme Inc",\n  "to": "Customer LLC",\n  "items": [\n    { "description": "Consulting", "quantity": 2, "unit_price": 100 }\n  ]\n}',
				required: true,
				description:
					'Invoice data: from, to, items[] (description, quantity?, unit_price), and optionally invoice_number, date, due, currency, tax_rate, notes. Deterministic: the same input produces a byte-identical PDF.',
				displayOptions: {
					show: {
						operation: ['invoice'],
					},
				},
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
						operation: ['fill', 'merge', 'invoice', 'extractPages', 'deletePages', 'rotate', 'split', 'watermark', 'pageNumbers', 'unlock', 'protect', 'setMetadata'],
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
						operation: ['fill', 'merge', 'invoice', 'extractPages', 'deletePages', 'rotate', 'split', 'watermark', 'pageNumbers', 'unlock', 'protect', 'setMetadata'],
					},
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

		const pdfBlob = async (itemIndex: number, binaryPropertyName: string): Promise<Blob> => {
			this.helpers.assertBinaryData(itemIndex, binaryPropertyName);
			const buffer = await this.helpers.getBinaryDataBuffer(itemIndex, binaryPropertyName);
			return new Blob([new Uint8Array(buffer)], { type: 'application/pdf' });
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

		if (operation === 'usage' && !hasCredential) {
			throw new NodeOperationError(
				this.getNode(),
				'The Get Usage operation requires a PDFops API credential (free key at https://pdfops.dev/pricing)',
			);
		}

		for (let i = 0; i < items.length; i++) {
			let options: IHttpRequestOptions;
			let binaryOut: { fileName: string; property: string } | undefined;
			let splitOut = false;

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
					options = {
						method: 'POST',
						url: `${BASE_URL}/api/invoice`,
						body: jsonParam('invoice', i),
						json: true,
						encoding: 'arraybuffer',
					};
					binaryOut = {
						fileName: (this.getNodeParameter('fileName', i) as string) || 'invoice.pdf',
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
					}
					if (spec.output === 'pdf') {
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
				if (binaryOut && !splitOut) options.returnFullResponse = true;
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
					returnData.push({
						json,
						binary: {
							[binaryOut.property]: await this.helpers.prepareBinaryData(
								full.body,
								binaryOut.fileName,
								'application/pdf',
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
