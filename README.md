# n8n-nodes-newlead

This is an n8n community node. It lets you use Newlead WhatsApp Platform in your n8n workflows.

Newlead is a WhatsApp CRM platform for managing leads, sending templates, and controlling AI responses.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
[Resources](#resources)
[Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

## Operations

- **Template → Send**: send an approved WhatsApp template. Options:
  - **Dynamic Variables**: values saved on the lead before the conversation starts. A qualification question whose "field name" matches a key is answered automatically.
  - **Manual Mode**: keep the AI paused so a person handles the conversation.
  - **Clear Previous Chat**: start the lead from scratch (previous messages hidden; summary, qualification, variables and follow-ups reset). The lead keeps its ID, name and phone.
- **Message → Send**: send a manual text message (WhatsApp & Instagram).
- **Lead → Create**: create a lead, or update it if the phone already exists in the bot.
- **Lead → Get / Get Many / Update**: read leads and update name, status and dynamic variables (only the listed variables change).
- **AI Control → Pause / Resume / Get Status**: control the AI for a lead (pause duration in minutes, 0 = indefinite).

## Credentials

You need a Newlead account and API credentials:

1. Sign up at https://dashboard.newlead.ai
2. Get your API credentials from the platform settings
3. Configure the Newlead API credentials in n8n with your API key

## Compatibility

Minimum n8n version: 1.0.0
Tested against n8n version: 1.x

## Usage

Connect the Newlead node to your workflows to automate WhatsApp messaging and lead management.

For new n8n users, check out the [Try it out](https://docs.n8n.io/try-it-out/) documentation.

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
* [Newlead Documentation](https://newlead.ai)

## Version history

### 0.6.0
- Template → Send: Dynamic Variables, Manual Mode and Clear Previous Chat
- Lead → Create
- Lead → Update keeps the variables that are not listed
- AI Control → Pause works again (minutes, 0 = indefinite)
- WhatsApp ID (BSUID) support for message send and lead lookup

### 0.1.0
- Initial release
- Support for sending WhatsApp templates
- Lead management operations
- AI response controls
