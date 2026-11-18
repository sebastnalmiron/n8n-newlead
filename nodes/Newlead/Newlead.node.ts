import type { INodeTypeBaseDescription, IVersionedNodeType } from 'n8n-workflow';
import { VersionedNodeType } from 'n8n-workflow';

import { NewleadV1 } from './v1/NewleadV1.node';
import { NewleadV2 } from './v2/NewleadV2.node';

export class Newlead extends VersionedNodeType {
	constructor() {
		const baseDescription: INodeTypeBaseDescription = {
			displayName: 'Newlead',
			name: 'newlead',
			icon: 'file:newlead.svg',
			group: ['transform'],
			description: 'Interact with Newlead Platform API (WhatsApp, Instagram & more)',
			defaultVersion: 2,
		};

		const nodeVersions: IVersionedNodeType['nodeVersions'] = {
			1: new NewleadV1(baseDescription),
			2: new NewleadV2(baseDescription),
		};

		super(nodeVersions, baseDescription);
	}
}
