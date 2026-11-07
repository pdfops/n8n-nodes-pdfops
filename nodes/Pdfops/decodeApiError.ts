/**
 * Pull `{ error, details }` out of a failed PDFops response.
 *
 * The PDF-producing operations request `encoding: 'arraybuffer'`, so on a 4xx the
 * AxiosError carries `response.data` as a Buffer. NodeApiError only mines
 * `.message` from an object body, so without this the user sees nothing but
 * "Request failed with status code 400" — even though the API said exactly which
 * field was wrong.
 */
export function decodeApiError(error: unknown): { message: string; details?: string } | undefined {
	// Credentialed requests fail as a NodeApiError, which keeps the original response
	// under .cause or .context rather than at the top level.
	const e = error as {
		response?: { data?: unknown; body?: unknown };
		cause?: { response?: { data?: unknown; body?: unknown } };
		context?: { data?: unknown };
	};
	const payload =
		e?.response?.data ??
		e?.response?.body ??
		e?.cause?.response?.data ??
		e?.cause?.response?.body ??
		e?.context?.data;
	if (payload === undefined || payload === null) return undefined;

	let parsed: { error?: string; details?: string } | undefined;
	if (typeof payload === 'object' && !Buffer.isBuffer(payload) && !(payload instanceof Uint8Array)) {
		parsed = payload as { error?: string; details?: string };
	} else {
		const text = Buffer.isBuffer(payload)
			? payload.toString('utf8')
			: payload instanceof Uint8Array
				? Buffer.from(payload).toString('utf8')
				: String(payload);
		try {
			parsed = JSON.parse(text) as { error?: string; details?: string };
		} catch {
			return undefined;
		}
	}
	return typeof parsed?.error === 'string'
		? { message: parsed.error, details: typeof parsed.details === 'string' ? parsed.details : undefined }
		: undefined;
}
