# Feature plan: Editable members (inline) — PROPOSAL, not yet binding

> Status: **draft feature plan.** This covers only the **editable-members
> feature/UI**. It deliberately does **not** define the scope hierarchy,
> storage, or authorization — those are owned by:
> - **[multi-tenant.md](multi-tenant.md)** — the tenant → team → member data
>   model and storage (members are a tenant-level registry; capability lives on
>   `team_members`).
> - **[permissions.md](permissions.md)** — the `(actor, action, target)` model,
>   the permission-role vs. team-role split, and the `can(action, target)`
>   resolver + action matrix that gate every control below.
>
> This plan references those; it does not restate them. Detailed UI design is
> **deferred until we build** (per review decision) — what follows is the intent
> and the constraints it must respect.

## Goal

Make **everything about a member editable** from the Members view, with an
interaction style consistent with the rest of the UI — inline editing that
mirrors how `EventsView` edits roster slots (the slot picker and the `+ Role`
control). No separate modal; edit in place on the card.

## Interaction intent (mirrors EventsView)

- **Inline field edit** like the roster slot picker: click a value → input /
  dropdown in place; Enter/blur commits, Esc cancels. Reuse the existing
  `glassMenu` surface, `zPopover`/`zInCard` layering, and `useClickOutside`.
- **Team-roles** edit like event role pills: tags get an "×"; a dashed
  `+ Role` control opens a `glassMenu` of the team's declared roles; each added
  role has an understudy toggle (matches the card's existing understudy tags).
  *(Writes back as schedulable capability — see multi-tenant.md; it is **not** a
  permission change.)*
- **Name / telegram / active toggle / note** — inline controls using the card's
  existing `tierSection` label chrome.
- **Availability** — edit on the existing minimalist calendar (click a day to
  toggle unavailable; ranges still render via `expandUnavailableDays`).
- **Add member** — a card-shaped `+ Add member` affordance at the end of the grid
  (mirrors `+ Role`). **Remove member** — a small per-card control with a confirm
  step (reuse the slot-removal confirm affordance).

## Hard constraints this feature must respect

1. **Every control is gated by `can(action, memberTarget)`** (see
   [permissions.md](permissions.md)). Denied controls are simply not rendered
   (read-only), exactly as `onEditRosterSlot` is passed only when
   `permissions.canEditRoster`. In particular: profile/availability follow
   `member:edit-profile` / `member:edit-availability` (owner/admin/**self**);
   note/active/add/remove/team-roles are governance (owner/admin); a member can
   **self-assign** to eligible slots (`roster:assign-self`).
2. **Team-role edits are capability data, not governance.** They write to the
   member's team membership, never to any RBAC field.
3. **Persistence follows the data layer's draft/commit contract** — do not invent
   a second persistence path. Ratified: member edits are **staged as a draft and
   committed in one transaction (reviewed publish)**, mirroring the roster
   draft/commit feel even though members are normalized rows — see
   [multi-tenant.md](multi-tenant.md#ratified-decisions) /
   [data-layer.md](data-layer.md).
4. **`member.id` is immutable** (it keys constraints/preferences and assignment
   `member_id`); editing changes display `name` only.
5. **Schema literals → constants.** The `member_constraints` / `member_preferences`
   object keys (`member_id`, `unavailable_dates`, `note`, `days`, `roles`) are
   currently string literals; promote them to `rosterSchema.js` constants when
   edits start writing them (decision-check: don't scatter literals).

## Deferred (resolve at build time)

- Availability write-back granularity (toggle days → coalesce to `{start,end}`).
- Whether member changes appear in the Save/Discard change-review diff.
- Exact add-member inline editor layout.
