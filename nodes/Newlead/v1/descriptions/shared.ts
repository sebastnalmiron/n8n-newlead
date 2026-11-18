import type { INodeProperties } from 'n8n-workflow';

/**
 * The `dynamicVariables` fixedCollection (key/value rows) used by both the
 * Template and Lead resources. Only the visibility rule and the description
 * texts differ between them.
 */
export function dynamicVariablesField(options: {
	show: { resource: string[]; operation: string[] };
	description: string;
	keyDescription: string;
	valueDescription: string;
}): INodeProperties {
	return {
		displayName: 'Dynamic Variables',
		name: 'dynamicVariables',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
		},
		default: {},
		placeholder: 'Add Variable',
		displayOptions: {
			show: options.show,
		},
		options: [
			{
				displayName: 'Variable',
				name: 'variables',
				values: [
					{
						displayName: 'Key',
						name: 'key',
						type: 'string',
						default: '',
						description: options.keyDescription,
					},
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
						description: options.valueDescription,
					},
				],
			},
		],
		description: options.description,
	};
}
