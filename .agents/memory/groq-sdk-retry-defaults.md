---
name: Groq SDK retry defaults
description: Pinned Groq SDK behavior relevant to application-owned reliability policies
---

The pinned Groq SDK performs automatic retries by default, including for timeouts, network failures, 408, 409, 429, and 5xx responses; it also supports per-request timeout and maxRetries controls.

**Why:** Application-level retries can silently multiply requests and user-visible latency when the SDK retry policy remains enabled.

**How to apply:** Whenever adding a shared Groq reliability boundary, explicitly set the SDK retry count and make the application the single retry owner.