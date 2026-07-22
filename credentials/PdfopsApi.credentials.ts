import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

export class PdfopsApi implements ICredentialType {
	name = 'pdfopsApi';

	displayName = 'PDFops API';

	icon: Icon = { light: 'file:pdfops.svg', dark: 'file:pdfops.dark.svg' };

	documentationUrl = 'https://pdfops.dev/docs/signup';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			description:
				'Free key (250 requests/month, no card) from https://pdfops.dev/pricing. Without a credential the node still works anonymously at 100 requests/IP/month.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-API-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://pdfops.dev',
			url: '/api/usage',
			method: 'GET',
		},
	};
}
