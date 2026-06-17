# UI/CLI Copy Language

This file is the source of truth for user-facing UI and CLI copy language in Dev Config Hub. Update this file before changing the active copy language mode, default locale, or supported locales.

## Mode

`single-language`: Simplified Chinese (`zh-CN`) for all user-facing product UI and CLI copy.

## Scope

This file applies to text shown or spoken to users: Tauri UI labels, navigation, buttons, headings, form help, errors, notifications, empty states, CLI output, command help, prompts, confirmations, validation messages, backup/restore copy, profile-management copy, progress text, and user-facing terminal errors.

This file does not govern code identifiers, protocol names, logs, developer comments, test names, or third-party strings unless those strings are rendered to users.

## Rules

- Write new UI/CLI copy in natural Simplified Chinese by default.
- Keep technical identifiers as-is: command names, flags, profile IDs, file paths, environment variables, config keys, schema fields, JSON/TOML keys, tool names, provider names, and product names such as Claude, Codex, OpenCode, and Dev Config Hub.
- If a user requests UI/CLI copy in another language or locale, update this file first and then make the copy change.
- If project code and this file disagree, stop and update this file or ask for the intended language mode before changing UI/CLI copy.
