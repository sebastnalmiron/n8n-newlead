import type { IDataObject, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { v1RequestAll } from './transport';

function toOptions(agents: IDataObject[]): INodePropertyOptions[] {
	return agents.map((agent) => ({ name: agent.name as string, value: agent.id as string }));
}

/** Every text agent of the key's subaccount. */
export async function getTextAgents(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	return toOptions(await v1RequestAll.call(this, '/text_agents'));
}

/** Every voice agent of the key's subaccount. */
export async function getVoiceAgents(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	return toOptions(await v1RequestAll.call(this, '/voice_agents'));
}

/** Voice agents without a text agent: one with a text agent has no leads of its own, they are the text agent's. */
export async function getStandaloneVoiceAgents(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const agents = await v1RequestAll.call(this, '/voice_agents');
	return toOptions(agents.filter((agent) => !agent.text_agent_id));
}
