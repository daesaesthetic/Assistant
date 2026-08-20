# Azurion Assistant — Discord Bot

A fully modular Discord bot built with discord.js v14. Features slash commands, AI-powered conversation (Groq/Llama 3.3), image generation (Pollinations.ai), web search (DuckDuckGo), persona system, and AutoMod.

## Run & Operate

- `pnpm --filter @workspace/discord-bot run dev` — start the bot
- `pnpm --filter @workspace/discord-bot run deploy` — register slash commands with Discord (run once after changes)
- `pnpm --filter @workspace/discord-bot run typecheck` — TypeScript check

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Discord: discord.js v14
- LLM: Groq API (llama-3.3-70b-versatile for text, llama-4-scout for vision)
- Image generation: Pollinations.ai (free, no key)
- Search: DuckDuckGo HTML (free, no key)
- DB: SQLite (`artifacts/discord-bot/data/azurion.sqlite`) with async access and versioned startup migrations

## Where things live

- `artifacts/discord-bot/src/commands/` — one file per slash command
- `artifacts/discord-bot/src/events/` — Discord event handlers
- `artifacts/discord-bot/src/utils/` — Groq client, embeds, cooldowns, search
- `artifacts/discord-bot/src/database/index.ts` — SQLite-backed database abstraction
- `artifacts/discord-bot/data/azurion.sqlite` — runtime data (personas, warnings, conversations, memories, traits, and guild configuration)
- `artifacts/discord-bot/data/db.json` — original JSON source retained for recovery
- `artifacts/discord-bot/data/db.json.pre-sqlite.bak` — migration-time JSON backup

## Commands

| Command | Description | Cooldown |
|---|---|---|
| `/talk` | AI conversation with memory and persona | 5s |
| `/suggest` | Smart suggestions, supports image input | 10s |
| `/edit` | AI image transformation via Pollinations | 30s |
| `/persona` | Set conversation style (5 presets + custom) | — |
| `/search` | Web search via DuckDuckGo | 10s |
| `/profile` | User profile with tracked stats | — |
| `/say` | Bot sends a message | — |
| `/commands` | Command list | — |
| `/credits` | Creator info | — |

## AutoMod

Detects spam (5 msgs/5s), excessive caps (>70%), and blacklisted words. Issues warnings; applies 10-min timeout at 3 warnings. Logs to configurable mod channel.

## Required Secrets

- `DISCORD_BOT_TOKEN` — bot login token
- `DISCORD_CLIENT_ID` — application ID
- `GROQ_API_KEY` — free at console.groq.com

## Setup Steps

1. Add secrets (already done via Replit Secrets)
2. Enable **Message Content Intent** and **Server Members Intent** in Discord Developer Portal → Bot settings
3. Start the bot workflow — it connects to Discord
4. Run `pnpm --filter @workspace/discord-bot run deploy` once to register slash commands
5. Global commands take up to 1 hour to propagate (use guild commands for instant testing)

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- After changing any command's name/options, re-run `deploy` to push updates to Discord
- The `MessageContent` privileged intent must be enabled in the Developer Portal or automod won't work
- The `GuildMembers` privileged intent is required for `/profile` and member timeouts
- SQLite schema migrations are tracked in `schema_migrations` and applied sequentially at startup before Discord login.
- Conversation history is scoped to USER + GUILD. `/talk reset` clears only the current user's conversation in the current guild.

## SQLite rollback procedure

The bot currently uses `artifacts/discord-bot/data/azurion.sqlite`. The original JSON snapshot is retained at
`artifacts/discord-bot/data/db.json.pre-sqlite.bak` and is from migration time; it may not include changes made
after that backup was created.

Rollback is not automatic and should only be considered if SQLite persistence is determined to be faulty:

1. Stop the `Azurion Discord Bot` workflow before touching either database.
2. Create an additional backup of `azurion.sqlite` and the current `db.json`.
3. Restore the JSON snapshot to `artifacts/discord-bot/data/db.json` only after confirming which later SQLite changes may be lost.
4. The current application has no runtime switch back to the old JSON persistence layer. To use JSON again, restore
   a prior project revision containing the JSON database implementation, then start the bot with the restored code.
5. Keep the SQLite backup so the rollback can be reviewed or reversed.

Restoring the migration-time JSON snapshot can lose any memories, conversations, personas, traits, warnings, or guild
configuration changes written to SQLite after the snapshot was created.
