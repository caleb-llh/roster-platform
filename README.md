# Roster Builder

**Roster Builder turns a team's roles, people, and events into a fair, valid
schedule — in one click, and fully editable by hand.**

It answers the recurring headache of volunteer and shift scheduling: *"who does
what, on which day, without overloading the same few people or breaking the
rules?"* You describe the team once; the app generates a roster that respects
the hard rules and balances the soft ones, then lets you review, tweak, and
publish it.

Live app: **https://caleb-llh.github.io/roster-builder/**

## What it does

- **One-click generation.** Click **Auto** and every open slot is filled with an
  eligible person, balancing workload, spacing out shifts, and honouring day/role
  preferences. Nothing is destroyed — the result is a reviewable *draft* you can
  undo.
- **Only fills the gaps.** Re-running generation *adds* to the roster; it never
  reshuffles assignments you've already made or reviewed. Your work stays put.
- **Respects the rules.** Availability, role qualifications, monthly caps, and
  once-per-event limits are hard constraints — the generator will never violate
  them, and neither can a manual edit (it's flagged if you try).
- **Understudies / training.** People can be marked as *training* for a role.
  The roster schedules them to shadow first, then promotes them into the real
  role once they've had enough practice.
- **Full manual control.** Assign, swap (drag-and-drop), or bulk-clear slots by
  hand. Every change is validated live.
- **Review before you publish.** Edits accumulate in a draft with an inline,
  IDE-style change list. **Save** publishes; **Discard** throws it away.
- **Live quality read-out.** A statistics panel shows workload balance, shift
  spacing, role rotation, and any roles that *can't* be filled — recomputed in
  real time as you edit.
- **Export.** Copy the finished roster to a spreadsheet or CSV.

## Who it's for

- **Schedulers / coordinators** who assemble a recurring roster (church service
  teams, volunteer rotas, on-call shifts) and want fairness without a spreadsheet
  full of manual bookkeeping.
- **Team leads** who need training pipelines (understudies) and role
  qualifications enforced automatically.

## Two ways to run it

The same app runs in one of two modes, chosen at deployment time:

- **Local playground** *(default, no sign-in)* — a free, in-memory editor. Paste
  or edit a roster document and experiment; nothing is saved. This is the public
  GitHub Pages deployment.
- **Production** *(Supabase-backed)* — rosters are saved to a database behind
  Google sign-in, with per-roster roles (owner / editor / viewer) and an admin
  flow for inviting collaborators.

The mode is decided purely by configuration — there is no separate "local build".

## How generation works (in brief)

1. **Schedule the trainees first** so understudies get their shadowing sessions
   early and can be promoted in time.
2. **Reserve promotions** for as many trainees as possible before the schedule
   fills up.
3. **Fill the roster greedily**, scoring each candidate on fairness, spacing, and
   preferences.
4. **Refine** by swapping the newly-placed slots to improve the overall balance —
   without touching anything that was already there.

The result is deterministic (the same input always yields the same roster) and
every decision is captured in an "Algorithm log" you can inspect.

## Documentation

| Audience | Read this |
| --- | --- |
| **Product / this overview** | You're here. |
| **Developers — getting started** | [`CONTRIBUTING.md`](CONTRIBUTING.md) — setup, dev/build/deploy commands, testing, and how the AI-assisted workflow works. |
| **The binding specification** *(why the system behaves as it does)* | [`specs/`](specs/) — the authoritative design decisions, one file per domain: [architecture](specs/architecture.md), [data layer](specs/data-layer.md), [generation](specs/generation.md), [understudy](specs/understudy.md), [design system](specs/design-system.md), [events UI](specs/events-ui.md). |
| **How any change must feed back into the spec** | [`AGENTS.md`](AGENTS.md) — the mandatory code → tests → spec → verify loop. |
| **Generator internals & scoring weights** | [`src/generation/README.md`](src/generation/README.md). |
