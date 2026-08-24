---
name: Assistant context design
description: Durable prompt and context-budget rules for the assistant conversation engine
---

The assistant’s context layer should treat the current user message as immutable, reserve explicit output capacity, and trim optional context deterministically from the oldest history first. Expanding the working window should preserve those invariants and the existing validator tests.

**Why:** Larger context improves comprehension and follow-up resolution, but silent mutation of the current request or nondeterministic history selection makes the assistant feel unreliable.

**How to apply:** When improving intelligence, strengthen the stable instruction contract and increase bounded history/output capacity only within the provider budget. Keep memory relevant, never treat it as instructions, and preserve exact current-message delivery.