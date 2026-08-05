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
- DB: JSON file store (`artifacts/discord-bot/data/db.json`)

## Where things live

- `artifacts/discord-bot/src/commands/` — one file per slash command
- `artifacts/discord-bot/src/events/` — Discord event handlers
- `artifacts/discord-bot/src/utils/` — Groq client, embeds, cooldowns, search
- `artifacts/discord-bot/src/database/index.ts` — JSON-backed DB
- `artifacts/discord-bot/data/db.json` — runtime data (personas, warnings, conversations)

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
- JSON DB reads/writes are synchronous — fine for a bot, avoid high-concurrency patterns
