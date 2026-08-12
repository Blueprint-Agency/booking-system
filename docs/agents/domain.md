# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo is **multi-context**: `fe-client/`, `fe-portal/`, and `be/` are decoupled apps with their own vocabulary and their own decisions.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`<context>/CONTEXT.md`** — the glossary for the app you're working in (`fe-client/`, `fe-portal/`, `be/`).
- **`docs/adr/`** — system-wide decisions. Also check `<context>/docs/adr/` for context-scoped ones.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

`docs/md/` holds the canonical product/architecture specs (`prd.md`, `backend-architecture.md`, `be-client.md`, `be-portal.md`, …). Those are specs, not glossaries — read them for behaviour, read `CONTEXT.md` for vocabulary.

## File structure

```
/
├── CONTEXT-MAP.md
├── docs/
│   ├── adr/                    ← system-wide decisions
│   └── md/                     ← canonical product & architecture specs
├── fe-client/
│   ├── CONTEXT.md
│   └── docs/adr/               ← client-app decisions
├── fe-portal/
│   ├── CONTEXT.md
│   └── docs/adr/               ← portal-app decisions
└── be/
    ├── CONTEXT.md
    └── docs/adr/               ← backend decisions
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

A term that means different things in `fe-client` and `be` belongs in both glossaries, with the difference spelled out — that's the point of a context map.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
