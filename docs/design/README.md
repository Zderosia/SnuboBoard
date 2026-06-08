# Design Documents

This directory holds design documents for proposed features and changes to Planka.

## Purpose

Design documents provide a structured way to plan, discuss, and approve changes before implementation begins. They help ensure alignment across the team and reduce rework by thinking through the problem and solution upfront.

## When to Create a Design Document

- Before starting implementation of a new feature or significant change
- When the scope or approach is non-trivial and benefits from team review
- When multiple parts of the codebase or services are affected

## Design Document Structure

Each design document should cover the following sections:

1. **Motivation** – What problem are we solving? Why now?
2. **Overview** – High-level summary of the proposed solution
3. **High-Level Architecture** – How does the solution fit into the existing system? Include diagrams if helpful.
4. **Affected Files / Areas** – Which parts of the codebase will be impacted by this change?
5. **Open Questions** – Unresolved decisions, trade-offs, or areas needing further discussion

## Process

1. Create a design document using the naming convention below.
2. Review the document separately from implementation (e.g., via PR on the document itself).
3. Implementation begins only after the design document is approved.
4. Link the design document from the relevant issue or ticket.

## Naming Convention

```
docs/design/<feature-name>.md
```

Use a concise, kebab-case identifier for the feature or change (e.g., `docs/design/card-due-date-notifications.md`).
