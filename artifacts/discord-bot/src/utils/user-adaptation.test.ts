import assert from "node:assert/strict";
import test from "node:test";
import {
  detectPreferenceSignals,
  formatUserPreferences,
} from "./user-adaptation.js";
import { db } from "../database/index.js";

test("turns explicit style corrections into preference signals", () => {
  const signals = detectPreferenceSignals(
    "You're too formal. Be more casual and keep it brief.",
  );

  assert.deepEqual(
    signals.map((signal) => [signal.key, signal.value, signal.source]),
    [
      ["preferred_verbosity", "concise", "explicit"],
      ["preferred_tone", "casual", "correction"],
    ],
  );
});

test("only formats established preferences for prompt use", () => {
  const context = formatUserPreferences([
    {
      key: "preferred_tone",
      value: "casual",
      confidence: 0.8,
      evidenceCount: 2,
      source: "correction",
      createdAt: 1,
      updatedAt: 2,
    },
    {
      key: "humor_tolerance",
      value: "light_humor",
      confidence: 0.4,
      evidenceCount: 1,
      source: "inferred",
      createdAt: 1,
      updatedAt: 2,
    },
  ]);

  assert.match(context, /preferred tone: casual/);
  assert.doesNotMatch(context, /light_humor/);
});

test("raises repeated evidence and dampens conflicting preference signals", async () => {
  const userId = "preference-test-user";
  const guildId = "preference-test-guild";
  const key = "preferred_verbosity";

  await db.clearPreferences(userId, guildId);
  try {
    await db.recordPreferenceSignals(userId, guildId, [
      { key, value: "concise", confidence: 0.9, source: "explicit" },
    ]);
    const first = (await db.getPreferences(userId, guildId))[0];
    assert.equal(first?.value, "concise");
    assert.equal(first?.evidenceCount, 1);

    await db.recordPreferenceSignals(userId, guildId, [
      { key, value: "concise", confidence: 0.9, source: "explicit" },
    ]);
    const repeated = (await db.getPreferences(userId, guildId))[0];
    assert.equal(repeated?.evidenceCount, 2);
    assert.ok((repeated?.confidence ?? 0) > (first?.confidence ?? 1));

    await db.recordPreferenceSignals(userId, guildId, [
      { key, value: "detailed", confidence: 0.9, source: "correction" },
    ]);
    const conflicting = (await db.getPreferences(userId, guildId))[0];
    assert.equal(conflicting?.value, "detailed");
    assert.equal(conflicting?.evidenceCount, 3);
    assert.ok((conflicting?.confidence ?? 1) < (repeated?.confidence ?? 0));
  } finally {
    await db.clearPreferences(userId, guildId);
  }
});