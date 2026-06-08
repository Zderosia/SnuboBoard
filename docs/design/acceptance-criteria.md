# Acceptance Criteria

## Motivation

Cards in the current system lack a structured mechanism for defining the conditions that must be met before a card can be considered complete. Teams currently rely on descriptions, comments, or external tools to track what "done" means for a given card. This leads to:

- **Ambiguous completion:** Without explicit criteria, "moving to Done" is subjective and varies between team members.
- **No progress visibility:** A card in "In Progress" provides no insight into how close it is to being complete.
- **Inconsistent quality:** Without a checklist, cards may be marked complete prematurely, skipping important validation steps.
- **Tool sprawl:** Teams may maintain acceptance criteria in external documents, breaking the single-source-of-truth workflow the board is meant to provide.

Acceptance criteria solve these problems by providing a structured, in-context checklist that is visible to all board members and tied directly to the card lifecycle.

## Overview

Add a new section called **"Acceptance Criteria"** to every card. The section provides a checklist-style interface where board members can:

- Define individual criteria items as plain-text entries.
- Check off each item as it is completed.
- See completion progress at a glance (e.g., "3/5 criteria met").
- Optionally enforce that all criteria must be met before the card can be moved to a "Done"-style list.

This feature works on both **Project** and **Story** card types.

### User-facing behavior

1. **Card detail view:** A new "Acceptance Criteria" section appears in the card modal, positioned alongside existing sections (Description, Custom Field Groups, Task Lists, Attachments, Communication).

2. **Checklist items:** Each criterion is a single-line text entry with a checkbox. Items can be reordered via drag-and-drop.

3. **Completion tracking:** The section header displays a progress indicator (e.g., a badge or small bar showing `2/5`).

4. **Required before moving to "Done":** When enabled at the board or project level, attempting to move a card to a closed list (e.g., "Done") will be blocked if any acceptance criteria remain unchecked. A confirmation dialog explains which criteria are incomplete.

## Proposed Behavior

### Section placement

The "Acceptance Criteria" section will be rendered as a first-class module within the card modal, following the same pattern as existing modules (Task Lists, Custom Field Groups, Attachments). It will appear:

- **In Project cards:** Between the Description module and the Custom Field Groups module (or after Custom Field Groups, before Task Lists — to be decided).
- **In Story cards:** In the equivalent position within the StoryContent layout.

The section is only visible when criteria exist or the user has edit permissions (matching the pattern used for Description and Task Lists, which show an "Add" prompt for editors even when empty).

### Checklist item structure

Each acceptance criterion item has the following properties:

| Field          | Type    | Description                              |
| -------------- | ------- | ---------------------------------------- |
| `id`           | string  | Unique identifier (UUID or Snowflake ID) |
| `cardId`       | string  | ID of the parent card                    |
| `name`         | string  | Text of the criterion (required, max 1024 chars) |
| `isCompleted`  | boolean | Whether this criterion has been checked off |
| `position`     | number  | Sort order within the card               |
| `creatorUserId`| string  | ID of the user who created this criterion |
| `assigneeUserId`| string | Optional: ID of the user responsible for this criterion |

### Progress display

The section header shows:

- **Text:** "Acceptance Criteria" with a badge showing `X/Y` (e.g., "Acceptance Criteria · 3/5").
- **Visual:** When all items are complete, the section header icon or badge turns green.
- **Card front:** If enabled, a small progress indicator appears on the card front (similar to how Task Lists with `showOnFrontOfCard` are displayed).

### Required enforcement

When the board-level setting `requireAcceptanceCriteriaForCompletion` is enabled:

1. Attempting to move a card to a closed list (via drag-and-drop or the list selector) triggers validation.
2. If any criteria are incomplete, the move is blocked and a notification explains which criteria remain.
3. The user must either complete all criteria or explicitly override the requirement.

This is a **soft gate** — it can be overridden by the user, similar to how due date warnings work but with a confirmation step.

## Architecture & Technical Approach

### Approach A: Child model (recommended)

Create a new model: `AcceptanceCriterion` (direct child of `Card`), analogous to how `Attachment` and `Comment` are direct children of `Card`.

```
Card 1──* AcceptanceCriterion
```

**Schema:**
```sql
CREATE TABLE acceptance_criterion (
  id BIGINT PRIMARY KEY,
  card_id BIGINT NOT NULL REFERENCES card(id),
  name VARCHAR(1024) NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  position BIGINT NOT NULL,
  creator_user_id BIGINT REFERENCES user(id),
  assignee_user_id BIGINT REFERENCES user(id),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE INDEX idx_acceptance_criterion_card_id ON acceptance_criterion(card_id);
```

**Pros:**
- Follows the existing pattern established by direct Card children such as Attachment and Comment.
- Each criterion is a first-class entity with its own ID, enabling granular socket events and activity tracking.
- Supports future extensions (assignee, due date per criterion, sub-items).
- Position-based ordering via the existing `insertToPositionables` utility.
- Cascading deletes handled naturally by Sails.js ORM.
- Individual criteria can be referenced in actions/activity log entries.

**Cons:**
- Requires a new database migration and table.
- More server-side code: model, controllers, helpers, policies.
- Initial fetch of a board loads all criteria (mitigated by the fact that TaskLists/Tasks already do this).

---

### Approach B: JSON field on Card

Store the criteria as a JSON array on the `Card` model, similar to how `stopwatch` is stored:

```javascript
// Card.js
acceptanceCriteria: {
  type: 'json',
  // { items: [{ id, name, isCompleted, position, creatorUserId, assigneeUserId }] }
},
```

**Pros:**
- Zero new tables or migrations (alter the Card model only).
- Simpler server-side: update criteria via the existing Card update endpoint.
- Fewer files to modify overall.
- Atomic updates — criteria and card always in sync.

**Cons:**
- No individual IDs for criteria, making granular socket events and activity tracking harder.
- Reordering, adding, or removing a single criterion requires reading/writing the entire array.
- Cannot easily reference a specific criterion in an Action/Activity entry.
- Harder to extend with per-criterion relationships (assignee, etc.) without changing the JSON schema.
- Deviates from how child collections are handled (TaskList/Task, CustomFieldGroup/CustomField).
- No database-level referential integrity for `cardId` or `assigneeUserId`.
- Difficult to query across cards (e.g., "find all incomplete criteria for a user").

---

### Recommendation: Approach A

**Approach A (child model) is recommended** because:

1. It aligns with the existing architecture where card-related child items (tasks, attachments, custom field values) are first-class models.
2. It enables granular real-time sync via individual socket events (`acceptanceCriterionCreate`, `acceptanceCriterionUpdate`, etc.).
3. It supports activity tracking at the criterion level (e.g., "Alice completed criterion 'Verify login flow'").
4. The additional complexity is well-contained and follows established patterns.

### Server implementation details (Approach A)

#### New model: `server/api/models/AcceptanceCriterion.js`

- Follows the `Attachment.js` / `Comment.js` pattern (direct child of Card): `id`, `cardId`, `name`, `isCompleted`, `position`, `createdAt`, `updatedAt`.
- Links to `Card` via `cardId` foreign key (card gains `acceptanceCriteria` collection).
- Links to `User` via optional `assigneeUserId` (for per-criterion ownership).
- Includes `creatorUserId` to track who created each criterion. Note: this is a new concept — Tasks do not track a creator at the item level. This follows the pattern used by Attachment and Comment, which both track `creatorUserId`.

#### Card model update: `server/api/models/Card.js`

- Add collection: `acceptanceCriteria: { collection: 'AcceptanceCriterion', via: 'cardId' }`.
- Update swagger schema to include `acceptanceCriteria` in the response.

#### New controllers: `server/api/controllers/acceptance-criteria/`

| File        | Endpoint                                      | Description              |
| ----------- | --------------------------------------------- | ------------------------ |
| `create.js` | `POST /cards/:cardId/acceptance-criteria`     | Create a new criterion   |
| `update.js` | `PATCH /acceptance-criteria/:id`              | Update a criterion       |
| `delete.js` | `DELETE /acceptance-criteria/:id`             | Delete a criterion       |

Follows the `tasks/` controller pattern (path-based auth, position management, socket broadcast, webhooks).

#### New helpers: `server/api/helpers/acceptance-criteria/`

| File                     | Description                                  |
| ------------------------ | -------------------------------------------- |
| `create-one.js`          | Create criterion with position management    |
| `update-one.js`          | Update criterion (name, isCompleted, position) |
| `delete-one.js`          | Delete criterion and reposition siblings     |
| `delete-related.js`      | Cascade delete when card is deleted          |
| `get-path-to-project-by-id.js` | Navigate from criterion → card → list → board → project |

#### Card helpers update: `server/api/helpers/cards/delete-related.js`

- Add cascade deletion of `acceptanceCriteria` alongside existing child models (taskLists, attachments, etc.).

#### Card controller update: `server/api/controllers/cards/show.js`

- Populate `acceptanceCriteria` alongside `taskLists`, `tasks`, `attachments`, etc.
- Update the Swagger documentation (`@swagger` block) to include `acceptanceCriteria` in the response schema's included data.
- Update the actual response payload to include the fetched criteria in the returned JSON.

#### Migration: `server/db/migrations/YYYYMMDDHHMMSS_add_acceptance_criteria.js`

- Creates the `acceptance_criterion` table with columns: `id`, `card_id`, `name`, `is_completed`, `position`, `creator_user_id`, `assignee_user_id`, `created_at`, `updated_at`.
- Adds index on `card_id`.

#### Actions and activity tracking

- Add new `Action.Types` for criterion completion:
  - `COMPLETE_ACCEPTANCE_CRITERION`
  - `UNCOMPLETE_ACCEPTANCE_CRITERION`
- These follow the same pattern as `COMPLETE_TASK`/`UNCOMPLETE_TASK` in `tasks/update-one.js`.

#### Board-level settings

- Add `requireAcceptanceCriteriaForCompletion` boolean to the `Board` model (or potentially at the `Project` level).
- Validation in the card move helper: `server/api/helpers/cards/update-one.js` checks this setting before allowing a move to a closed list.

#### Webhook event constants: `server/api/models/Webhook.js`

- Add new webhook event constants to the `Webhook.Events` enum, following the pattern established in `tasks/create-one.js` and other helpers:
  - `ACCEPTANCE_CRITERION_CREATE`
  - `ACCEPTANCE_CRITERION_UPDATE`
  - `ACCEPTANCE_CRITERION_DELETE`
- These constants are referenced by the acceptance criterion helpers (`create-one.js`, `update-one.js`, `delete-one.js`) when calling `sails.helpers.utils.sendWebhooks`.

### Client implementation details

#### New model: `client/src/models/AcceptanceCriterion.js`

- Redux-ORM model following `Task.js` pattern.
- Fields: `id`, `cardId`, `name`, `isCompleted`, `position`, `creatorUserId`, `assigneeUserId`.
- FK to `Card` with `relatedName: 'acceptanceCriteria'`.
- Reducer handles the full lifecycle: `ACCEPTANCE_CRITERION_CREATE/UPDATE/DELETE/HANDLE` action types.
- `duplicate()` and `deleteWithRelated()` methods for card duplication and deletion.

#### Card model update: `client/src/models/Card.js`

- Add `acceptanceCriteria` to the Card reducer's upsert paths (board fetch, card create handle, card transfer success, card duplicate success).
- Add `deleteRelated()` cascade for acceptance criteria.
- Add `duplicate()` cascade for acceptance criteria.

#### Entry actions: `client/src/entry-actions/acceptance-criteria.js`

| Action                                 | Description                            |
| -------------------------------------- | -------------------------------------- |
| `createAcceptanceCriterionInCurrentCard(data)` | Create new criterion |
| `handleAcceptanceCriterionCreate(item)`  | Handle server-created criterion    |
| `updateAcceptanceCriterion(id, data)`    | Update criterion (name, isCompleted, position) |
| `handleAcceptanceCriterionUpdate(item)`  | Handle server-updated criterion    |
| `moveAcceptanceCriterion(id, index)`     | Reorder criterion                    |
| `deleteAcceptanceCriterion(id)`          | Delete criterion                     |
| `handleAcceptanceCriterionDelete(item)`  | Handle server-deleted criterion    |

#### API: `client/src/api/acceptance-criteria.js`

- `createAcceptanceCriterion(cardId, data, headers)`
- `updateAcceptanceCriterion(id, data, headers)`
- `deleteAcceptanceCriterion(id, headers)`

#### Sagas: `client/src/sagas/core/watchers/acceptance-criteria.js` + `services/acceptance-criteria.js`

- Watchers map entry actions to saga services.
- Services handle the optimisitc-update-then-API-call pattern (local ID creation, success/failure dispatch).

#### EntryActionTypes: `client/src/constants/EntryActionTypes.js`

- Add acceptance criterion action types following the existing naming convention:
  ```
  ACCEPTANCE_CRITERION_IN_CURRENT_CARD_CREATE
  ACCEPTANCE_CRITERION_CREATE_HANDLE
  ACCEPTANCE_CRITERION_UPDATE
  ACCEPTANCE_CRITERION_UPDATE_HANDLE
  ACCEPTANCE_CRITERION_MOVE
  ACCEPTANCE_CRITERION_DELETE
  ACCEPTANCE_CRITERION_DELETE_HANDLE
  ```

#### UI components: `client/src/components/cards/AcceptanceCriteria/`

| File                     | Description                          |
| ------------------------ | ------------------------------------ |
| `index.js`               | Barrel export                        |
| `AcceptanceCriteria.jsx` | Main container component             |
| `AcceptanceCriteria.module.scss` | Styles                  |
| `Item.jsx`               | Single criterion row                 |
| `Item.module.scss`       | Item styles                          |

The component follows the `TaskLists/TaskLists.jsx` pattern:

- Renders a module section within the card modal.
- Uses `react-beautiful-dnd` for drag-and-drop reordering.
- Each item has an inline checkbox and editable text field.
- The header shows the completion progress badge.

**Placement in card modal:**

- **ProjectContent.jsx:** Add the `<AcceptanceCriteria />` component between the Description module and Custom Field Groups.
- **StoryContent.jsx:** Add the same component in the equivalent position.

**Sidebar "Add to card" button:**

- Add an "Acceptance Criteria" button in the sidebar (similar to "Task List") for initial creation, or rely on inline creation within the section itself.

#### Selectors: `client/src/selectors/`

- Add selectors for fetching acceptance criteria by card ID: `makeSelectAcceptanceCriterionIdsByCardId`.
- These follow the existing pattern used for `selectTaskListIdsForCurrentCard`.

#### Locales: `client/src/locales/*/core.js`

- Add strings for:
  - `acceptanceCriteria` (section title)
  - `acceptanceCriterion` (singular)
  - `addAcceptanceCriterion` (action label)
  - `acceptanceCriteriaRequired` (enforcement message)
  - `enterAcceptanceCriterion` (placeholder)
  - `xOfYCriteriaMet` (progress indicator)

#### Board model update: `client/src/models/Board.js`

- Add `requireAcceptanceCriteriaForCompletion` attribute to the Redux-ORM Board model.
- This setting would be toggleable in board settings (existing `BoardSettings` component).

## Affected Files

### Server

| Category   | File/Path                                                              | Action       |
| ---------- | ---------------------------------------------------------------------- | ------------ |
| Model      | `server/api/models/AcceptanceCriterion.js`                             | **Create**   |
| Model      | `server/api/models/Card.js`                                            | Modify       |
| Model      | `server/api/models/Board.js`                                           | Modify       |
| Model      | `server/api/models/Action.js`                                          | Modify       |
| Model      | `server/api/models/Webhook.js`                                         | Modify       |
| Controller | `server/api/controllers/acceptance-criteria/create.js`                 | **Create**   |
| Controller | `server/api/controllers/acceptance-criteria/update.js`                 | **Create**   |
| Controller | `server/api/controllers/acceptance-criteria/delete.js`                 | **Create**   |
| Controller | `server/api/controllers/cards/show.js`                                 | Modify       |
| Helper     | `server/api/helpers/acceptance-criteria/create-one.js`                 | **Create**   |
| Helper     | `server/api/helpers/acceptance-criteria/update-one.js`                 | **Create**   |
| Helper     | `server/api/helpers/acceptance-criteria/delete-one.js`                 | **Create**   |
| Helper     | `server/api/helpers/acceptance-criteria/delete-related.js`             | **Create**   |
| Helper     | `server/api/helpers/acceptance-criteria/get-path-to-project-by-id.js`  | **Create**   |
| Helper     | `server/api/helpers/cards/delete-related.js`                           | Modify       |
| Helper     | `server/api/helpers/cards/update-one.js`                               | Modify       |
| Migration  | `server/db/migrations/YYYYMMDDHHMMSS_add_acceptance_criteria.js`       | **Create**   |

### Client

| Category   | File/Path                                                                        | Action       |
| ---------- | -------------------------------------------------------------------------------- | ------------ |
| Model      | `client/src/models/AcceptanceCriterion.js`                                       | **Create**   |
| Model      | `client/src/models/Card.js`                                                      | Modify       |
| Model      | `client/src/models/Board.js`                                                     | Modify       |
| Model      | `client/src/models/index.js`                                                     | Modify       |
| API        | `client/src/api/acceptance-criteria.js`                                          | **Create**   |
| API        | `client/src/api/index.js`                                                        | Modify       |
| EntryAction| `client/src/entry-actions/acceptance-criteria.js`                                | **Create**   |
| EntryAction| `client/src/entry-actions/index.js`                                              | Modify       |
| Constants  | `client/src/constants/EntryActionTypes.js`                                       | Modify       |
| Saga       | `client/src/sagas/core/watchers/acceptance-criteria.js`                          | **Create**   |
| Saga       | `client/src/sagas/core/watchers/index.js`                                        | Modify       |
| Saga       | `client/src/sagas/core/services/acceptance-criteria.js`                          | **Create**   |
| Saga       | `client/src/sagas/core/services/index.js`                                        | Modify       |
| Component  | `client/src/components/cards/AcceptanceCriteria/index.js`                        | **Create**   |
| Component  | `client/src/components/cards/AcceptanceCriteria/AcceptanceCriteria.jsx`          | **Create**   |
| Component  | `client/src/components/cards/AcceptanceCriteria/AcceptanceCriteria.module.scss`  | **Create**   |
| Component  | `client/src/components/cards/AcceptanceCriteria/Item.jsx`                        | **Create**   |
| Component  | `client/src/components/cards/AcceptanceCriteria/Item.module.scss`                | **Create**   |
| Component  | `client/src/components/cards/CardModal/ProjectContent.jsx`                       | Modify       |
| Component  | `client/src/components/cards/CardModal/StoryContent.jsx`                         | Modify       |
| Selectors  | `client/src/selectors/` (new selectors file or existing board/card selectors)     | Modify       |
| Locales    | `client/src/locales/*/core.js` (all locale directories)                          | Modify       |
| ORM        | `client/src/orm.js`                                                              | Modify       |

## Open Questions

1. **Required enforcement scope:** Should `requireAcceptanceCriteriaForCompletion` be a board-level setting, a project-level setting, or configurable per card? Board-level is the simplest starting point and aligns with other board settings like `alwaysDisplayCardCreator`.

2. **Override behavior:** When enforcement is enabled and criteria are incomplete, should the user be able to override the block? If so, should it require a confirmation dialog, or be silently allowed? Recommendation: confirmation dialog that explicitly states which criteria are incomplete, with an "Move anyway" option.

3. **Criterion assignment:** Should each criterion have an `assigneeUserId`? This would allow assigning responsibility for individual criteria, similar to how Tasks have assignees. This adds complexity (requires a user picker in the UI, board membership validation) but significantly increases the feature's value. Recommendation: include it in the initial design but mark it as a "nice-to-have" that can be deferred.

4. **Markdown support:** Should criterion names support markdown formatting? Tasks currently use plain text. Recommendation: plain text only for v1, consistent with Task names.

5. **Activity log granularity:** Should completing/uncompleting a criterion create an Activity entry? This would make the audit trail more detailed but could produce noise for cards with many criteria. Recommendation: yes, following the `COMPLETE_TASK`/`UNCOMPLETE_TASK` pattern.

6. **Card front display:** Should acceptance criteria progress be visible on the card front (similar to Task Lists with `showOnFrontOfCard`)? Recommendation: a simple progress badge (e.g., "2/5") in the card front metadata, not a full checklist preview.

7. **Empty state:** Should the acceptance criteria section be visible on cards that have no criteria yet? Recommendation: yes, for editors — show an "Add acceptance criterion" prompt, consistent with the Description section pattern.

8. **Bulk operations:** Should there be bulk complete/uncomplete actions? Recommendation: not in v1. Can be added later if requested.

9. **Migration for existing cards:** Since this is a new table with no data migration needed, existing cards will simply have zero acceptance criteria. No data migration is required.

10. **API versioning:** Should the new endpoints be versioned? The existing API does not appear to use versioned endpoints, so the new endpoints would follow the existing convention.

11. **Webhook events:** Should acceptance criterion changes trigger webhook events? Recommendation: yes, following the existing webhook pattern (`ACCEPTANCE_CRITERION_CREATE`, `ACCEPTANCE_CRITERION_UPDATE`, `ACCEPTANCE_CRITERION_DELETE`).

12. **Socket event naming:** The socket events should follow existing naming: `acceptanceCriterionCreate`, `acceptanceCriterionUpdate`, `acceptanceCriterionDelete`. Should there also be a batch event for card-level operations? Recommendation: individual events only, consistent with how Task events work.

13. **Card transfer behavior:** What happens to criterion assignees when a card is transferred between boards? The existing Task pattern (in `client/src/models/Card.js` `syncAfterBoardChange()`) clears assignees on tasks that are not members of the target board. Should acceptance criteria follow the same approach — i.e., clear `assigneeUserId` for criteria whose assignee is not a member of the destination board? Recommendation: yes, follow the Task pattern for consistency.
