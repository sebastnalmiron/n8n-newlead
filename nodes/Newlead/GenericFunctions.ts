import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
} from 'n8n-workflow';

/**
 * Make an API request to Newlead
 */
export async function newleadApiRequest(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	method: IHttpRequestMethods,
	endpoint: string,
	body: IDataObject = {},
	query: IDataObject = {},
): Promise<unknown> {
	const credentials = await this.getCredentials('newleadApi');
	const baseUrl = credentials.baseUrl as string;

	const options: IHttpRequestOptions = {
		method,
		body,
		qs: query,
		url: `${baseUrl}${endpoint}`,
		json: true,
	};

	if (Object.keys(body).length === 0) {
		delete options.body;
	}

	if (Object.keys(query).length === 0) {
		delete options.qs;
	}

	try {
		const response = await this.helpers.httpRequestWithAuthentication.call(
			this,
			'newleadApi',
			options,
		);
		return response;
	} catch (error: unknown) {
		// Debug: log error structure to understand n8n's error format
		const err = error as Record<string, unknown>;
		
		// Try to extract error from httpCode property (n8n sometimes uses this)
		if (err.httpCode === '502' || err.httpCode === 502) {
			// Try different paths to get the response
			const errorResponse = err.response as Record<string, unknown> | undefined;
			const causeResponse = (err.cause as Record<string, unknown>)?.response as Record<string, unknown> | undefined;
			
			// Get body from whichever path exists
			const body = (errorResponse?.body || causeResponse?.body || err.body) as Record<string, unknown> | undefined;
			
			if (body && typeof body === 'object' && body.error && typeof body.error === 'string') {
				// Replace the generic error with the backend's detailed message
				throw new Error(body.error);
			}
		}

		// If we couldn't extract a better message, throw original
		throw error;
	}
}

/**
 * Load bots for dropdown
 */
export async function getBots(
	this: ILoadOptionsFunctions,
): Promise<Array<{ name: string; value: string }>> {
	try {
		const response = (await newleadApiRequest.call(this, 'GET', '/bots')) as IDataObject;

		const bots = (response.data || response) as IDataObject[];

		if (!Array.isArray(bots)) {
			return [];
		}

		return bots.map((bot: IDataObject) => ({
			name: (bot.name as string) || 'Unnamed Bot',
			value: (bot.bot_id as string) || (bot.id as string),
		}));
	} catch {
		// Return empty array on error - n8n will show "No data"
		return [];
	}
}

/**
 * Load templates for a specific bot
 */
export async function getTemplates(
	this: ILoadOptionsFunctions,
	botId: string,
): Promise<Array<{ name: string; value: string; description?: string }>> {
	if (!botId) {
		return [];
	}

	try {
		const response = (await newleadApiRequest.call(
			this,
			'GET',
			`/bots/${botId}/templates`,
		)) as IDataObject;

		const templates = (response.templates || response.data || response) as IDataObject[];

		if (!Array.isArray(templates)) {
			return [];
		}

		return templates
			.filter((t: IDataObject) => t.template_status === 'APPROVED')
			.map((template: IDataObject) => ({
				name: `${template.template_name} (${template.language})`,
				value: `${template.template_name}|${template.language}`,
				description: `${template.category} - ${template.template_status}`,
			}));
	} catch {
		return [];
	}
}

/**
 * Load leads for a specific bot
 */
export async function getLeads(
	this: ILoadOptionsFunctions,
	botId: string,
): Promise<Array<{ name: string; value: string }>> {
	if (!botId) {
		return [];
	}

	try {
		const response = (await newleadApiRequest.call(
			this,
			'GET',
			`/bots/${botId}/leads`,
		)) as IDataObject;

		const leads = (response.data || response) as IDataObject[];

		if (!Array.isArray(leads)) {
			return [];
		}

		return leads.map((lead: IDataObject) => ({
			name: lead.name
				? `${lead.name} (${lead.phone_number})`
				: (lead.phone_number as string),
			value: lead.lead_id as string,
		}));
	} catch {
		return [];
	}
}

/**
 * Get template details including components/variables info
 */
export async function getTemplateDetails(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	botId: string,
	templateName: string,
): Promise<IDataObject | null> {
	if (!botId || !templateName) {
		return null;
	}

	const response = (await newleadApiRequest.call(
		this,
		'GET',
		`/bots/${botId}/templates`,
	)) as IDataObject;

	const templates = (response.templates || response.data || response) as IDataObject[];

	if (!Array.isArray(templates)) {
		return null;
	}

	return (templates.find((t: IDataObject) => t.template_name === templateName) as IDataObject) || null;
}

/**
 * Build template components from unified structure
 */
export function buildTemplateComponentsFromUnified(componentsRaw: IDataObject[]): IDataObject[] {
	const components: IDataObject[] = [];
	const bodyVariables: IDataObject[] = [];
	const buttons: IDataObject[] = [];
	let headerComponent: IDataObject | null = null;

	for (const comp of componentsRaw) {
		const componentType = comp.componentType as string;

		if (componentType === 'header') {
			const headerType = comp.headerType as string;
			const parameters: IDataObject[] = [];

			if (headerType === 'text' && comp.headerText) {
				parameters.push({ type: 'text', text: comp.headerText });
			} else if (headerType === 'image' && comp.headerUrl) {
				parameters.push({ type: 'image', image: { link: comp.headerUrl } });
			} else if (headerType === 'video' && comp.headerUrl) {
				parameters.push({ type: 'video', video: { link: comp.headerUrl } });
			} else if (headerType === 'document' && comp.headerUrl) {
				parameters.push({
					type: 'document',
					document: {
						link: comp.headerUrl,
						filename: comp.headerFilename || undefined,
					},
				});
			}

			if (parameters.length > 0) {
				headerComponent = { type: 'header', parameters };
			}
		} else if (componentType === 'body') {
			// Body variables are now nested in bodyVariables.variables
			const bodyVars = comp.bodyVariables as IDataObject;
			if (bodyVars && bodyVars.variables) {
				const variables = bodyVars.variables as IDataObject[];
				for (const variable of variables) {
					const varType = variable.type as string;

					if (varType === 'text' || varType === 'date_time') {
						bodyVariables.push({ type: varType === 'text' ? 'text' : 'date_time', text: variable.value });
					} else if (varType === 'currency') {
						bodyVariables.push({
							type: 'currency',
							currency: {
								fallback_value: variable.fallback,
								code: variable.currencyCode,
								amount_1000: variable.amount,
							},
						});
					}
				}
			}
		} else if (componentType === 'button') {
			buttons.push({
				type: comp.buttonType || 'text',
				subType: comp.buttonSubType || 'quick_reply',
				value: comp.buttonValue,
			});
		}
	}

	// Add header first if exists
	if (headerComponent) {
		components.push(headerComponent);
	}

	// Add body variables
	if (bodyVariables.length > 0) {
		components.push({ type: 'body', parameters: bodyVariables });
	}

	// Add buttons
	buttons.forEach((button, index) => {
		const parameters: IDataObject[] = [];

		if (button.type === 'text' || button.type === 'payload') {
			parameters.push({ type: 'text', text: button.value });
		}

		if (parameters.length > 0) {
			components.push({
				type: 'button',
				sub_type: button.subType || 'quick_reply',
				index: index.toString(),
				parameters,
			});
		}
	});

	return components;
}

/**
 * Build template components for sending (DEPRECATED - use buildTemplateComponentsFromUnified)
 */
export function buildTemplateComponents(
	headerParams: IDataObject | undefined,
	bodyParams: IDataObject[] | undefined,
	buttonParams: IDataObject[] | undefined,
): IDataObject[] {
	const components: IDataObject[] = [];

	// Header component
	if (headerParams && Object.keys(headerParams).length > 0) {
		const headerType = headerParams.type as string;
		const parameters: IDataObject[] = [];

		if (headerType === 'text' && headerParams.text) {
			parameters.push({ type: 'text', text: headerParams.text });
		} else if (headerType === 'image' && headerParams.url) {
			parameters.push({ type: 'image', image: { link: headerParams.url } });
		} else if (headerType === 'video' && headerParams.url) {
			parameters.push({ type: 'video', video: { link: headerParams.url } });
		} else if (headerType === 'document' && headerParams.url) {
			parameters.push({
				type: 'document',
				document: {
					link: headerParams.url,
					filename: headerParams.filename || undefined,
				},
			});
		}

		if (parameters.length > 0) {
			components.push({ type: 'header', parameters });
		}
	}

	// Body component
	if (bodyParams && Array.isArray(bodyParams) && bodyParams.length > 0) {
		const parameters: IDataObject[] = bodyParams.map((param) => {
			const paramType = (param.type as string) || 'text';

			if (paramType === 'text') {
				return { type: 'text', text: param.value || param.text };
			} else if (paramType === 'currency') {
				return {
					type: 'currency',
					currency: {
						fallback_value: param.fallbackValue,
						code: param.code,
						amount_1000: param.amount,
					},
				};
			} else if (paramType === 'date_time') {
				return {
					type: 'date_time',
					date_time: {
						fallback_value: param.value || param.fallbackValue,
					},
				};
			}
			return { type: 'text', text: param.value };
		});

		components.push({ type: 'body', parameters });
	}

	// Button components
	if (buttonParams && Array.isArray(buttonParams) && buttonParams.length > 0) {
		buttonParams.forEach((button, index) => {
			const parameters: IDataObject[] = [];

			if (button.type === 'text' || button.type === 'payload') {
				parameters.push({ type: 'text', text: button.value });
			}

			if (parameters.length > 0) {
				components.push({
					type: 'button',
					sub_type: button.subType || 'quick_reply',
					index: index.toString(),
					parameters,
				});
			}
		});
	}

	return components;
}
