# Plan: Tech Loss Modal Redesign

> Source PRD: PRD pasted inline in conversation (no file path — PRD describes a redesign of the tech loss modal to use clickable team cards instead of radio buttons)

## Architectural decisions

- **Files in scope**: `CoreFrontend/src/views/tournaments/modals/TechLossPlayoffModal.vue`, `TechLossQualificationModal.vue`
- **New shared component**: `CoreFrontend/src/components/MatchTeamSelectCard.vue`
- **Design system**: Element Plus (`el-dialog`, `el-select`, `el-button`) + Tailwind CSS + Phosphor Icons — no new dependencies
- **API surface**: unchanged — all existing service calls preserved verbatim
  - Playoff: `tournamentsService.fetchPlayoffOpenMatches(tournamentId)` → `tournamentsService.adminTechLossPlayoffMatch(tournamentId, winnerTeamId, loserTeamId)`
  - Qualification: matches passed as prop → `tournamentsService.adminTechLossQualificationMatch(matchId, winnerTeamId)`
- **Color tokens**:
  - Winner: `border-green-500`, `bg-green-900/30`, `shadow-green-700/30`
  - Loser: `border-red-500/60`, `bg-red-900/20`, opacity muted
  - Neutral: `border-white/10`, standard dark bg
- **Modal width**: increase to `560px` to accommodate side-by-side cards
- **Match select**: both modals use `el-select` with `filterable` (playoff modal currently uses radio buttons — switch to select)

---

## Phase 1: MatchTeamSelectCard component

**User stories**: visual feedback (winner/loser/neutral states), clickable card area, team logo + name display, hover states, smooth transitions, accessibility

### What to build

A standalone Vue component `MatchTeamSelectCard.vue` that accepts a minimal team shape (`{ id, name, logoUrl? }`), a `state` prop (`'neutral' | 'winner' | 'loser'`), and emits `click`. It renders:

- Full-width card with rounded corners, dark background
- Team logo (with PhUsersThree fallback if none)
- Team name centered below logo
- State-driven border + background glow:
  - `winner`: green border + soft green bg glow + elevation shadow + crown/trophy icon badge
  - `loser`: red border + muted red bg tint + reduced opacity
  - `neutral`: subtle white/10 border, full opacity
- Smooth `transition-all duration-200` on all state changes
- Hover: subtle border brightening when state is neutral
- Entire card surface is clickable (`cursor-pointer`)
- Keyboard: `tabindex="0"`, Space/Enter triggers click

The component has zero internal state — all display logic is driven by the `state` prop. Logic about *which* team is winner/loser stays in the parent modal.

### Acceptance criteria

- [ ] Component renders correctly in all three states (neutral, winner, loser) with correct colors
- [ ] Logo image renders; falls back to icon placeholder if `logoUrl` is null/undefined or load fails
- [ ] Click anywhere on card fires the `click` emit
- [ ] Hover state visually responds when card is in neutral state
- [ ] State transitions animate smoothly (no flicker)
- [ ] Component is keyboard-accessible (Tab focus, Space/Enter triggers emit)
- [ ] No navigation side-effect — card never routes anywhere

---

## Phase 2: Redesign both modals

**User stories**: searchable match dropdown, side-by-side team cards replace radio buttons, winner/loser visual feedback, disabled submit until both selections made, empty state for no matches, fallback for match without teams, success toast, cancel button

### What to build

Replace the radio-button UI in both modals with the new card-based layout. Both modals follow the same structure:

**Match Select** (top section):
- `el-select` with `filterable` and placeholder `"Оберіть матч"`
- Option label format: `"Team A vs Team B"` (playoff adds `— раунд N`)
- Section hidden / disabled while data is loading

**Teams Section** (appears after match selected):
- Two `MatchTeamSelectCard` components in a `flex gap` row, equal width
- Clicking a card sets it as winner; the other automatically becomes loser
- Clicking the current winner deselects (returns both to neutral)

**Footer**:
- Cancel: ghost button, unchanged
- Submit: primary button, disabled until match + winner both selected; shows loading spinner during submission

**Modal width**: `560px` for both.

**Empty states**:
- No matches: show `"Немає відкритих матчів"` message, submit disabled
- Match without valid teamA/teamB: show `"Дані матчу недоступні"` fallback, prevent rendering cards

**Playoff-specific**: on `@open`, fetch matches via `fetchPlayoffOpenMatches` (existing logic, unchanged). Replace the match radio-group with `el-select`.

**Qualification-specific**: matches already passed as prop — just remove the radio-group and wire up the cards. No fetch logic change.

All existing submit/error/toast logic stays identical — only the selection UI changes.

### Acceptance criteria

- [ ] Playoff modal: match list loads on open, shown in filterable `el-select`
- [ ] Qualification modal: matches from prop populate the `el-select`
- [ ] Teams section is hidden until a match is selected
- [ ] Clicking a team card marks it winner (green) and the other loser (red)
- [ ] Clicking the same card again deselects (both return to neutral)
- [ ] Submit button is disabled until both match and winner are selected
- [ ] Submit calls the correct service method with correct arguments
- [ ] Success toast appears on submit; modal closes
- [ ] Error toast appears on failure; modal stays open
- [ ] Empty-match state renders the fallback message
- [ ] Broken-team-data state renders fallback instead of crashing
- [ ] Modal width is 560px on both
- [ ] Cancel closes modal without saving
