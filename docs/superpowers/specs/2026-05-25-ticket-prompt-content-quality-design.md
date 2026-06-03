# Ticket Bot Prompt — Content Quality Improvement

**Date:** 2026-05-25  
**File:** `ticket/bot.py` → `SYSTEM_PROMPT`

## Problem

Short requests produce tickets padded with invented details and generic closing sentences that carry no real information. Example output for "onboard Illia on Tuesday":

- Invented: "Підготовка презентації та матеріалів для ознайомлення з платформою"
- Invented: "Важливо забезпечити комфортний вступ до команди та надати всю необхідну інформацію для роботи."

Neither phrase came from the original request.

## Solution (Option C — surgical prompt rules)

Four additions/changes to `SYSTEM_PROMPT`:

### 1. Strict derivation rule (new section)
Every bullet point must be directly derivable from the request text. The model may expand an action into sub-steps only if those steps are unambiguous consequences of what was stated. It may not invent platforms, materials, audience descriptions, or procedures that were not mentioned.

### 2. Short-request summarizing paragraph — removed
The current prompt permits "один звичний абзац із речень (після булетів) із логічними узагальненнями" for short requests. This is removed entirely. Short requests produce 2 bullets at most, nothing further.

### 3. Forbidden filler list (new rule)
Explicit ban on sentence starters and patterns that add no information:
- `Важливо забезпечити…`
- `Необхідно забезпечити…`
- `Підготуйте всі необхідні…`
- `Забезпечити комфортний…`
- Any closing motivational / moralizing sentence not derived from the request

### 4. Missing-info acknowledgement (new rule)
If a detail is clearly expected (deadline, platform, access level) but absent from the request, the bullet states that explicitly:
- `• Термін — не вказано в запиті`
- `• Платформа — не вказано в запиті`

Do not invent plausible-sounding values.

## What does NOT change
- Ticket structure (sections, separators, emoji)
- Formatting rules
- Priority / Area logic
- Team mention / assignment logic
