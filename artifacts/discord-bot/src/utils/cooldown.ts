// In-memory per-user command cooldown tracker
const cooldowns = new Map<string, number>();

/**
 * Returns remaining cooldown in seconds, or 0 if the user is not on cooldown.
 */
export function checkCooldown(userId: string, commandName: string, cooldownSeconds: number): number {
  const key = `${userId}:${commandName}`;
  const lastUsed = cooldowns.get(key);
  if (!lastUsed) return 0;
  const elapsed = (Date.now() - lastUsed) / 1000;
  const remaining = cooldownSeconds - elapsed;
  return remaining > 0 ? remaining : 0;
}

/**
 * Records the current timestamp for a user's command usage.
 */
export function setCooldown(userId: string, commandName: string): void {
  cooldowns.set(`${userId}:${commandName}`, Date.now());
}
