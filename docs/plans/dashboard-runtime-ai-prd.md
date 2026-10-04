# PRD — dashboard-runtime-ai

> Status: frozen 2026-10-04

## Status

Draft. Ready for critic + gate.

## Problem

Creating an AI project needs native runtime started + AI configured. Dashboard shows Create using AI button disabled with hint, but shows no runtime status, no AI status, no Start/Stop controls. User must discover Workspace sidebar cards to fix it.

## User

Extension user on Dashboard tab deciding how to start a project.

## Outcome

- User sees why Create using AI disabled without leaving Dashboard.
- User can start runtime + verify AI ready from Dashboard.
- Dashboard and Workspace show same runtime/AI truth, styled to match.

## Scope / Non-goals

Scope:

- Dashboard system-status surface with Runtime card (Start/Stop, status line, extension ID + copy, diagnostics entry + error when failed/unsupported) and AI card (status + provider/model lines, never API key).
- Reuse existing commands/state (`refresh`, `check-ai-support`, `runtimeControlDisabled`, `runtimeStatusText`).
- Match F22 design tokens, responsive + a11y (focus, live status, forced colors, 200% zoom, narrow widths).
- Cover with unit + browser tests.

Non-goals:

- No new runtime lifecycle, no host install flow changes.
- No AI provider setup UI (CLI `ai setup` + host own that).
- No Workspace sidebar behavior change.
- No new permissions, storage keys, network calls.

## Requirements

1. Dashboard renders Runtime status + Start/Stop when user views Dashboard (traces to outcome 1, 2).
2. Dashboard renders AI status (needs runtime / Configured + provider/model / Not configured / not reported), never key (outcome 1, 2).
3. Create using AI disabled state matches same `aiSupported` truth shown on Dashboard (outcome 1, 3).
4. Controls share Workspace command handlers + disabled logic, update on `refresh` without losing Dashboard context (outcome 2, 3).
5. Visual style uses existing dashboard-card language, looks intentional next to Start a project / Your projects (outcome 3).

## Metrics

Omit — none sourced.

## Open questions

None.
