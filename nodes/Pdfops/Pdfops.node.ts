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
	INodeType,
	INodeTypeDescription,
	IDataObject,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

const BASE_URL = 'https://pdfops.dev';

export class Pdfops implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'PDFops',
		name: 'pdfops',
		icon: { light: 'file:pdfops.svg', dark: 'file:pdfops.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description:
			'Deterministic PDF operations via the PDFops API — inspect and fill AcroForm fields, merge PDFs, generate invoice PDFs',
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
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Fill Form',
						value: 'fill',
						action: 'Fill form fields in a PDF',
						description: 'Fill AcroForm form fields in a PDF and output the filled PDF',
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
						description: 'Check tier, limit, used, remaining, and reset date (requires an API key)',
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
				displayName: 'Input Binary Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				hint: 'The name of the input item’s binary field containing the PDF',
				displayOptions: {
					show: {
						operation: ['fill', 'inspect', 'merge'],
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
						operation: ['fill', 'merge', 'invoice'],
					},
				},
			},
			{
				displayName: 'Output File Name',
				name: 'fileName',
				type: 'string',
				default: '',
				placeholder: 'e.g. filled.pdf',
				description: 'File name for the output PDF. Defaults per operation.',
				displayOptions: {
					show: {
						operation: ['fill', 'merge', 'invoice'],
					},
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const operation = this.getNodeParameter('operation', 0) as string;

		let hasCredential = true;
		try {
			await this.getCredentials('pdfopsApi');
		} catch {
			hasCredential = false;
		}

		const request = async (options: IHttpRequestOptions): Promise<unknown> => {
			options.headers = { ...options.headers, 'X-Pdfops-Client': 'n8n' };
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
			// Parameter and binary-data problems throw NodeOperationError before
			// the API call; only transport/API failures reach the catch below.
			const binaryPropertyName = this.getNodeParameter('binaryPropertyName', 0) as string;
			const fileName = (this.getNodeParameter('fileName', 0) as string) || 'merged.pdf';
			const outputBinaryPropertyName = this.getNodeParameter(
				'outputBinaryPropertyName',
				0,
			) as string;
			const formData = new FormData();
			for (let i = 0; i < items.length; i++) {
				formData.append('pdf', await pdfBlob(i, binaryPropertyName), `input-${i}.pdf`);
			}
			try {
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
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: 0 },
					});
				} else {
					throw new NodeApiError(this.getNode(), error as JsonObject);
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
			// Parameter and binary-data problems throw NodeOperationError here,
			// before the API call; only transport/API failures reach the catch.
			let options: IHttpRequestOptions;
			let binaryOut: { fileName: string; property: string } | undefined;

			if (operation === 'inspect') {
				const formData = new FormData();
				formData.append(
					'pdf',
					await pdfBlob(i, this.getNodeParameter('binaryPropertyName', i) as string),
					'input.pdf',
				);
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
			} else if (operation === 'usage') {
				options = { method: 'GET', url: `${BASE_URL}/api/usage`, json: true };
			} else {
				throw new NodeOperationError(this.getNode(), `Unknown operation "${operation}"`, {
					itemIndex: i,
				});
			}

			try {
				const response = await request(options);
				if (binaryOut) {
					returnData.push({
						json: { fileName: binaryOut.fileName },
						binary: {
							[binaryOut.property]: await this.helpers.prepareBinaryData(
								response as Buffer,
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
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
