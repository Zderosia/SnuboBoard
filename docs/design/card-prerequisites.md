# Card Prerequisites

## Motivation

Cards in the current system have no way to express dependencies between them. Teams frequently need to track that one card should not be completed until another is finished. Without prerequisite tracking, this leads to:

- **Blocking dependencies hidden:** Team members may start work on a card without knowing it depends on another card that hasn't been completed yet.
- **Out-of-order work:** Cards may be marked complete in the wrong order, leading to integration issues, broken features, or rework.
- **Planning gaps:** Sprints and roadmaps benefit from understanding the dependency chain between cards. Without prerequisites, planners must rely on external documentation or communication.
- **Communication overhead:** Dependency information is communicated verbally or in comments rather than being a first-class, visible attribute of the card.

Adding prerequisite relationships between cards solves these problems by making blocking dependencies explicit, visible, and enforceable within the board itself.

## Overview

Allow each card to declare a **Prerequisite** — another card that must be completed before this card can be considered done. The relationship is directional:

- **Dependent card:** The card that is "blocked by" its prerequisite. It displays a visual indicator showing which card is blocking it.
- **Prerequisite card:** The card that is "blocking" the dependent card. It displays a visual indicator showing which cards depend on it.

The prerequisite relationship is established via a card picker within the card modal. When the prerequisite card is completed (moved to a closed list), the dependent card is automatically unblocked and its members are notified.

This feature works on both **Project** and **Story** card types.

## Proposed Behavior

### Single prerequisite per card

Each card can have exactly **one** prerequisite card. This keeps the relationship simple and avoids the complexity of multi-dependency graphs. If a card has multiple dependencies, the prerequisite should be set to the "last" dependency — the one that must complete before all others are satisfied.

### Visual indicators

**On the dependent card ("blocked by"):**
- **Card front:** A lock icon with the prerequisite card's ID displayed as a small badge (e.g., 🔒 `#12345`). If the prerequisite is incomplete, the lock is locked (closed). If the prerequisite is complete, the lock is open.
- **Card modal:** A "Prerequisite" section in the sidebar (similar to Due Date) showing the prerequisite card's name and list. The section is clickable to open a card picker for changing or removing the prerequisite.

**On the prerequisite card ("blocking"):**
- **Card front:** No special indicator. (The blocking card's front remains uncluttered.)
- **Card modal:** A "Dependent cards" count in the sidebar (e.g., "2 cards depend on this"). Clicking shows which cards are blocked by this card.

### Establishing the relationship

A "Prerequisite" button in the card modal sidebar opens a card picker popup. The card picker:
- Searches cards within the same board by name or ID
- Excludes the current card from the results (a card cannot be its own prerequisite)
- Excludes cards that are already in a closed list (they are already "done" and cannot be a prerequisite)
- Shows the card name and list in the search results

The user selects a card to set as the prerequisite. To remove a prerequisite, the user clicks a small "×" button next to the prerequisite card name in the modal sidebar.

**Note on already-satisfied prerequisites:** The UI prevents setting a closed card as a prerequisite, so the "already satisfied" scenario (where a prerequisite is in a closed list) should not occur through normal UI interaction. However, the server must handle this edge case for API consumers: if a card's `prerequisiteCardId` is set directly via the API to a card that is already in a closed list, the prerequisite is considered immediately satisfied. The dependent card is effectively unblocked from the start.

### When the prerequisite is completed

When the prerequisite card is moved to a closed list (e.g., "Done"):

1. The dependent card's lock icon updates to "unlocked" (open lock) via a real-time socket event.
2. Members of the dependent card receive a notification: "Prerequisite [Card Name] has been completed."
3. The dependent card is **not** automatically moved. The team retains full control over when to work on the unblocked card.

### Attempting to complete a card with unfinished prerequisites

When a user tries to move a card to a closed list (via drag-and-drop or the list selector in the modal):

1. If the card has a prerequisite that is not yet complete, the move is **blocked**.
2. A notification explains: "Cannot complete — prerequisite [Card Name] is not yet done."
3. The user must either complete the prerequisite first or remove the prerequisite relationship.

This is a **hard block** — there is no "override" option. The prerequisite relationship is meant to be a strict ordering constraint.

## Architecture & Technical Approach

### Approach: Self-referential FK on Card model

Add a nullable `prerequisiteCardId` field to the `Card` model. This is a self-referential foreign key: a card points to another card as its prerequisite.

This follows the same pattern as `Task.linkedCardId`, which is an optional FK from `Task` to `Card` — in both cases, a record holds an optional reference to a card. The key difference is that `prerequisiteCardId` is a self-reference on `Card`, whereas `linkedCardId` is a cross-model reference.

```
Card 1──* Card (via prerequisiteCardId)
```

#### Why single FK, not a join table?

| Criterion          | Self-referential FK (`prerequisiteCardId`) | Join table (`CardPrerequisite`) |
| ------------------ | ------------------------------------------ | ------------------------------- |
| Cardinality        | Enforces 1 prerequisite per card by schema | Requires application-level constraint |
| Query simplicity   | `WHERE prerequisiteCardId = ?`             | `SELECT ... JOIN card_prerequisite ...` |
| Cycle detection    | Linear chain traversal                     | Must handle arbitrary graph    |
| Migration          | One column addition                        | New table + index              |
| Consistency        | Matches `Task.linkedCardId` pattern        | No precedent in this codebase  |
| Multi-prerequisite | Not supported (by design for v1)           | Supported                      |

Self-referential FK is the clear choice for v1. Multi-prerequisite support is listed as an open question.

### Server implementation details

#### New field: `server/api/models/Card.js`

- Add `prerequisiteCardId` as a nullable string with `columnName: 'prerequisite_card_id'`.
- The FK points to `Card` itself (self-referential). Sails.js handles this via `model: 'Card'`.
- Update the swagger `Card` schema to include `prerequisiteCardId` with its description.

#### Migration: `server/db/migrations/YYYYMMDDHHMMSS_add_card_prerequisites.js`

```sql
ALTER TABLE card ADD COLUMN prerequisite_card_id BIGINT DEFAULT NULL;
CREATE INDEX idx_card_prerequisite_card_id ON card(prerequisite_card_id);
```

- All existing cards get `NULL`, preserving their current state.
- The index supports querying "which cards depend on card X."

#### Cycle detection

Before setting a new `prerequisiteCardId`, the server must detect cycles. A cycle would occur if card A's prerequisite is B, B's prerequisite is C, and C's prerequisite is A.

**Self-prerequisite check:** The server must also explicitly reject A's prerequisite = A (a chain of length 1 is a cycle). While the UI excludes the current card from the picker results, the server enforcement is required for API consumers.

**Algorithm:**
1. Starting from the proposed prerequisite card, walk up the chain of `prerequisiteCardId` references.
2. If the chain reaches the card being modified, reject the update (cycle detected).
3. Limit the walk to a reasonable depth (e.g., 100) to prevent infinite loops in case of data corruption.

This check is implemented in `server/api/helpers/cards/update-one.js` as part of the `prerequisiteCard` validation flow.

#### Controller updates

**`server/api/controllers/cards/create.js`:**
- Add `prerequisiteCardId` input (optional, nullable).
- Add to the `_.pick(inputs, [...])` values array.
- Update swagger doc.

**`server/api/controllers/cards/update.js`:**
- Add `prerequisiteCardId` input (optional, nullable).
- Add to the `availableInputKeys` for editors.
- Add to the `_.pick(inputs, [...])` values array.
- Validate that the referenced card exists and is not the current card.
- Update swagger doc.

#### Helper updates

**`server/api/helpers/cards/update-one.js`:**
- Accept and validate `prerequisiteCard` in values (similar to how `coverAttachment` is validated).
- Run cycle detection before persisting the change.
- On prerequisite change, broadcast a `cardUpdate` socket event.
- When a card's prerequisite is set to a card in a closed list, consider the prerequisite already satisfied (the dependent card is effectively unblocked from the start).

**`server/api/helpers/cards/create-one.js`:**
- Accept `prerequisiteCardId` in values and pass it through to the card creation.

**`server/api/helpers/cards/duplicate-one.js`:**
- Include `prerequisiteCardId` in the `_.pick(inputs.record, [...])` array. Duplicated cards retain the original prerequisite.

**`server/api/helpers/cards/delete-related.js`:**
- When a card is deleted, clear `prerequisiteCardId` on any cards that pointed to it. Follow the existing `Task.linkedCardId` pattern:
  ```javascript
  await Card.qm.update(
    { prerequisiteCardId: cardIdOrIds },
    { prerequisiteCardId: null },
  );
  ```

#### Cascade behavior on transfer

When a card is transferred between boards (`update-one.js` with `values.board`):
- If the card has a `prerequisiteCardId` pointing to a card on a different board, the prerequisite is cleared. A prerequisite relationship cannot span boards.
- If a card is transferred and other cards on the destination board had this card as a prerequisite, those prerequisite relationships are preserved (both cards are now on the same board).

#### Archive / trash behavior

When a dependent card is moved to Archive or Trash, its `prerequisiteCardId` is **preserved** (not cleared). The card may be restored to an active list, and the prerequisite relationship should survive the archive/trash lifecycle. This is consistent with how other card attributes (labels, members, due date, stopwatch) are preserved during archive and trash operations.

#### Audit logging (Action model)

The Action model tracks card-level events. Prerequisite lifecycle events should create Action records, following the existing pattern used by `COMPLETE_TASK` / `UNCOMPLETE_TASK` in `tasks/update-one.js`. The following action types are proposed:

- `setPrerequisite` — created when a prerequisite is assigned to a card
- `removePrerequisite` — created when a prerequisite is cleared by the user
- `clearPrerequisiteOnTransfer` — created when a prerequisite is cleared due to cross-board transfer
- `clearPrerequisiteOnDelete` — created when a prerequisite is cleared due to the prerequisite card's deletion

Each action stores the relevant card and prerequisite card details in the `data` JSON field, consistent with existing Action types. This is implemented in the relevant helpers (`update-one.js`, `delete-related.js`) using `sails.helpers.actions.createOne`.

### Client implementation details

#### Card model: `client/src/models/Card.js`

- Add a self-referential `fk()` for the prerequisite relationship, following the Redux-ORM pattern:
  ```javascript
  prerequisiteCardId: fk({
      to: 'Card',
      as: 'prerequisiteCard',
      relatedName: 'dependentCards',
  }),
  ```
  This resolves `card.prerequisiteCard` to the prerequisite Card instance and provides `card.dependentCards` to query cards blocked by this card.
- The `prerequisiteCardId` field flows through existing upsert/reducer paths. No new reducer cases needed for simple attribute updates.
- The `duplicate()` method must explicitly add `prerequisiteCardId` to its enumerated copied fields.

#### Card picker component

A new `SetPrerequisiteStep` component (similar to `SelectCardTypeStep`) provides a searchable card picker. It:

- Renders a text input for searching cards by name or ID
- Displays matching cards with their name and list
- Excludes the current card and cards in closed lists
- Selecting a card dispatches `entryActions.updateCurrentCard({ prerequisiteCardId: selectedCard.id })`
- Includes a "Remove prerequisite" option to clear the relationship

#### Card front indicator

A new `PrerequisiteBadge` component renders on the card front:

- **Position:** On the right side of the card, near the member avatars (labels are on the left, avatars on the right).
- **Appearance:** A small lock icon. Locked (🔒) when the prerequisite is incomplete, unlocked (🔓) when complete.
- **Tooltip:** Shows the prerequisite card's name and ID on hover.
- **Click:** Opens the card modal for the prerequisite card (not the dependent card).

#### Card modal integration

- **ProjectContent.jsx:** Add a "Prerequisite" section in the sidebar, below the "Due Date" section.
- **StoryContent.jsx:** Same placement.
- The section shows the prerequisite card name (clickable to open that card's modal), a lock icon indicating status, and a small "×" button to remove the prerequisite.

#### Notification on unblock

When a prerequisite card is completed (moved to a closed list), the server broadcasts `cardUpdate` events. The client detects that a card's prerequisite is now complete and triggers a notification for the dependent card's members.

This follows the existing pattern where `CARD_UPDATE_HANDLE` triggers Redux updates, and the notification system creates a personal notification for affected users.

#### Locales: `client/src/locales/*/core.js`

- Add strings for:
  - `common.prerequisite` (section title)
  - `common.prerequisites` (plural, sidebar title)
  - `common.setPrerequisite` (button label)
  - `common.prerequisiteNotMet` (block message)
  - `common.prerequisiteCompleted` (notification message)
  - `common.cardsDependentOnThis` (prerequisite card sidebar count)
  - `action.setPrerequisite` (popup title)
  - `action.removePrerequisite` (confirmation)

## Affected Files

### Server

| Category   | File/Path                                              | Action       |
| ---------- | ------------------------------------------------------ | ------------ |
| Model      | `server/api/models/Card.js`                            | Modify       |
| Model      | `server/api/models/Action.js`                          | Modify       |
| Controller | `server/api/controllers/cards/create.js`               | Modify       |
| Controller | `server/api/controllers/cards/update.js`               | Modify       |
| Helper     | `server/api/helpers/cards/update-one.js`               | Modify       |
| Helper     | `server/api/helpers/cards/create-one.js`               | Modify       |
| Helper     | `server/api/helpers/cards/duplicate-one.js`            | Modify       |
| Helper     | `server/api/helpers/cards/delete-related.js`           | Modify       |
| Migration  | `server/db/migrations/YYYYMMDDHHMMSS_add_card_prerequisites.js` | **Create** |

### Client

| Category   | File/Path                                                          | Action       |
| ---------- | ------------------------------------------------------------------ | ------------ |
| Model      | `client/src/models/Card.js`                                        | Modify       |
| Component  | `client/src/components/cards/SetPrerequisiteStep.jsx`             | **Create**   |
| Component  | `client/src/components/cards/SetPrerequisiteStep.module.scss`     | **Create**   |
| Component  | `client/src/components/cards/PrerequisiteBadge.jsx`               | **Create**   |
| Component  | `client/src/components/cards/PrerequisiteBadge.module.scss`       | **Create**   |
| Component  | `client/src/components/cards/CardModal/ProjectContent.jsx`         | Modify       |
| Component  | `client/src/components/cards/CardModal/StoryContent.jsx`           | Modify       |
| Component  | `client/src/components/cards/Card/ProjectContent.jsx`              | Modify       |
| Component  | `client/src/components/cards/Card/StoryContent.jsx`                | Modify       |
| Locales    | `client/src/locales/*/core.js` (all locale directories)            | Modify       |

## Open Questions

1. **Multiple prerequisites:** Should a card be able to have more than one prerequisite? The single-prerequisite design keeps the model simple and the cycle detection algorithm straightforward. Multi-prerequisite would require a join table (`CardPrerequisite`) and a graph-based cycle detection algorithm. Recommendation: single prerequisite for v1; multi-prerequisite is a future enhancement.

2. **Cross-board prerequisites:** Should a card on one board be able to depend on a card on another board? This would enable cross-team dependency tracking but adds complexity (the FK would point to a card on a different board, and the "complete" state must be resolved across boards). Recommendation: prerequisites are limited to cards within the same board for v1.

3. **Transitive dependencies:** Should the system detect and display transitive dependencies (e.g., "Card A depends on B, which depends on C")? This would provide deeper visibility into the dependency chain. Recommendation: out of scope for v1. The UI can show the direct prerequisite; transitive chains are a future enhancement.

4. **Auto-move on unblock:** Should a card be automatically moved to a specific list when its prerequisite is completed? This would enable workflow automation (e.g., "When prerequisite is done, move card to In Progress"). Recommendation: out of scope for v1. The current behavior (notification only) gives teams full control.

5. **Prerequisite completion definition:** Does "prerequisite completed" mean the prerequisite card is in a closed list (e.g., "Done"), or does it also include the trash list? The trash list is technically closed but represents deletion, not completion. Recommendation: prerequisite is satisfied when the prerequisite card is in any closed list (Done, Archive, Trash). The team can manage this by not setting prerequisites on cards that may end up in trash.

6. **Prerequisite and card duplication:** When a card is duplicated, should the duplicate inherit the original's prerequisite? Yes — this preserves the dependency relationship for the duplicate. If the user wants a different prerequisite on the duplicate, they can change it manually.

7. **Prerequisite and card deletion:** When a card is deleted, dependent cards have their `prerequisiteCardId` cleared (following the `Task.linkedCardId` pattern). Should there be a confirmation prompt when deleting a card that other cards depend on? Recommendation: yes — show a warning: "3 cards depend on this card. Their prerequisite will be cleared."

8. **Prerequisite and card transfer:** When a card is transferred between boards, its `prerequisiteCardId` is cleared if the prerequisite is on a different board. Should the transfer be blocked entirely if the card has a cross-board prerequisite? Recommendation: clear the prerequisite silently and notify the user. Blocking the transfer is too restrictive.

9. **Prerequisite visibility in board view:** Should the prerequisite indicator (lock icon) be visible on the card front? Recommendation: yes — the lock icon on the card front is essential for the feature's value, as it makes blocking relationships visible at a glance on the board.

10. **API for querying dependents:** Should there be a dedicated API endpoint to query "which cards depend on this card"? The existing `PATCH /cards/{id}` update endpoint handles setting/clearing prerequisites. A `GET /cards/{id}/dependents` endpoint could be useful but is not required for v1. The dependents can be derived client-side from the board's card list.
