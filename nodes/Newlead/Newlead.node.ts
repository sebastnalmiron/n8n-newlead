import type { INodeTypeBaseDescription, IVersionedNodeType } from 'n8n-workflow';
import { VersionedNodeType } from 'n8n-workflow';

import { NewleadV1 } from './v1/NewleadV1.node';

export class Newlead extends VersionedNodeType {
	constructor() {
		const baseDescription: INodeTypeBaseDescription = {
			displayName: 'Newlead',
			name: 'newlead',
			icon: 'file:newlead.svg',
			group: ['transform'],
			description: 'Interact with Newlead Platform API (WhatsApp, Instagram & more)',
			defaultVersion: 1,
		};

		const nodeVersions: IVersionedNodeType['nodeVersions'] = {
			1: new NewleadV1(baseDescription),
		};

		super(nodeVersions, baseDescription);
	}
}
