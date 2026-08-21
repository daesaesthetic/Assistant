---
name: Groq model availability
description: Durable guidance for handling Groq model retirement and unsupported model IDs.
---

Groq model identifiers can be retired while application code and SDK calls remain valid. An HTTP 404 from the Groq completion endpoint for a known model ID should be investigated as model availability before changing retries, queues, persistence, or Discord response handling.

**Why:** The bot’s existing response path was healthy, but the retired text model returned HTTP 404 in the live environment. Replacing it with a currently listed production model restored valid completions without architectural changes.

**How to apply:** Check Groq’s supported production models, update the narrowest model constant and matching documentation, then verify one completion through the shared reliability client and restart the workflow.