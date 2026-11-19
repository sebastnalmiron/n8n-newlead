# n8n-nodes-newlead

This is an n8n community node. It lets you use Newlead WhatsApp Platform in your n8n workflows.

Newlead is a WhatsApp CRM platform for managing leads, sending templates, and controlling AI responses.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

## 2.0.0

The node now has two versions. Existing workflows keep version 1 and nothing changes for them today, but version 1 will stop working when the old routes stop accepting API keys (announced in advance, no date yet). New nodes use version 2, which talks to the public API (`/v1`) and sends an `Idempotency-Key` on every send. Version 2 needs a subaccount API key, cannot be used as an AI agent tool, and requires phone numbers with the country code. Migration guide: https://docs.newlead.ai/migrate-legacy-routes

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

Version 2 of the node (new nodes). Pick the **Text Agent** first; every send carries an `Idempotency-Key`.

- **Template → Send**: send an approved WhatsApp template to a phone number with country code (the lead is created if it does not exist). Fields: **Header Type / Value / Filename**, **Body Variables** (`{{1}}`, `{{2}}`… in order) and **URL Buttons**. Options:
  - **Clear Previous Chat**: the agent starts this conversation from scratch.
  - **Pause AI**: the AI stops answering this lead after the template, so a person handles it.
  - **Source Lead ID**: the lead of the same person in another channel, such as the call that led here.
  - **Idempotency Key**: a stable key of your own, different for every send (see below).
  - **Lead Variables**: values saved on the lead; only the listed ones are added or changed.
- **Message → Send**: send a text message to a lead chosen from the list, by ID or by phone number. The lead must already exist and belong to the chosen agent. Option: **Idempotency Key**.
- **Lead → Create**: create a lead, or update it if the agent already has one with that phone. **Lead → Get / Update**: by list, ID or phone; update name, status and variables. **Lead → Get Many**: **Return All** or a **Limit**, filtered by **Status**.
- **AI Control → Pause / Resume / Get Status**: control the AI for a lead (**Pause Options**: duration in minutes and reason).
- **Property → Get by Reference**: find a property by Idealista listing code (full or its last 3+ digits) or internal reference. With **Simplify** on (default) the output is flat and ready for template variables (`found`, `status`, `reference`, `price`, `url`, `city`, `province`, `candidates_count`…). **Property → Get Many**: the properties published on Idealista, newest first, with their photos (`images`); **Return All** or a **Limit**. Both need a subaccount with an Idealista account connected.

Phone numbers need the country code: `612345678` is an error, `+34612345678` is valid. Version 2 needs a subaccount API key and cannot be used as an AI agent tool. Not in version 2: lookup by WhatsApp ID, the `currency` and `date_time` template variables and `quick_reply` buttons.

Retries: **Retry On Fail** normally does not send twice. Re-running a finished execution does, unless you set **Idempotency Key** (remembered 24 hours). With **On Error › Continue**, an error item carries `error` and `details` (`code`, `request_id`, `outcome_unknown`, `description`); if `outcome_unknown` is `true` the message may have gone out, so check before repeating.

Version 1 (workflows saved before 2.0.0) keeps working for now, but it calls the old routes, which will stop accepting API keys; we will announce it in advance, with no date yet. Move workflows to version 2: https://docs.newlead.ai/migrate-legacy-routes

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

### 2.0.0
- New node version 2 on the public API (`/v1`); workflows saved with version 1 are unchanged
- Sends carry an `Idempotency-Key`; the **Idempotency Key** option fixes your own
- Not available as an AI agent tool; errors carry `details`, including `outcome_unknown`
- Left out: lookup by WhatsApp ID, `currency` and `date_time` template variables, `quick_reply` buttons

### 0.10.0
- Template → Send: **Source Lead ID** joins the lead that receives the template to the person of another lead (e.g. the web chat they called from)

### 0.9.0
- Property → Get by Reference: `province` of the property, next to `city` (the municipality)

### 0.8.0
- Property → Get by Reference: each operation (sale and rent) with its own Idealista code and URL, and `operation` tells which one the reference matched

### 0.7.0
- Property → Get by Reference (properties imported from Idealista), with Simplify for template variables
- Resources listed alphabetically in the node

### 0.6.0
- Template → Send: Dynamic Variables, Manual Mode and Clear Previous Chat
- Lead → Create
- Lead → Update keeps the variables that are not listed
- AI Control → Pause sends the duration in minutes (0 = indefinite)
- WhatsApp ID (BSUID) support for message send and lead lookup: this finds an existing lead by its WhatsApp ID; the lead still needs a phone number on file to actually receive a WhatsApp message
- **Behaviour change**: Lead → Update now only adds or changes the listed variables (other variables are kept), rows with an empty value are ignored, and variables cannot be deleted from n8n.

### 0.1.0
- Initial release
- Support for sending WhatsApp templates
- Lead management operations
- AI response controls
