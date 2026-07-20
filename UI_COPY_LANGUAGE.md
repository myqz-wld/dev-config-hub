# UI/CLI Copy Language

This file is the source of truth for user-facing UI and CLI copy language. Update this file before changing the active copy language mode, default locale, or supported locales.

## Mode

- `single-language`: Simplified Chinese (`zh-CN`)

## Scope

This file applies to text shown or spoken to users: UI labels, navigation, buttons, headings, form help, errors, notifications, empty states, onboarding, marketing copy inside the product, accessibility labels, CLI output, command help, interactive prompts, confirmations, progress text, and user-facing terminal errors. In Dev Config Hub, this includes Tauri UI, validation, backup/restore, and profile-management copy.

This file does not govern code identifiers, protocol names, logs, developer comments, test names, or third-party strings unless those strings are rendered to users.

## Rules

- For this single-language project, write new UI/CLI copy only in natural Simplified Chinese (`zh-CN`).
- Do not infer product UI/CLI copy language from the user's conversation language; change product copy language only when the user explicitly asks for a UI/CLI copy language or locale change.
- Keep technical identifiers as-is: command names, flags, profile IDs, file paths, environment variables, config keys, schema fields, JSON/TOML keys, tool names, provider names, and product names such as Claude, Codex, and Dev Config Hub.
- If a user requests UI/CLI copy in a language or locale not listed here, update this file first and then make the copy change.
- If project code and this file disagree, stop and update this file or ask for the intended language mode before changing UI/CLI copy.
