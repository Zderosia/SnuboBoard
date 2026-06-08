# Card Priority Levels

## Motivation

Cards in the current system have no way to express urgency or importance relative to one another. When a board has many cards, teams struggle with:

- **Triage:** Without priority, it's unclear which cards should be addressed first. Team members must rely on position, due dates, or external communication to infer urgency.
- **Focus:** Sprints and daily stand-ups benefit from a clear signal of what matters most. Without priority, teams may work on low-impact items while critical work sits unattended.
- **Communication:** Stakeholders and new board members need an at-a-glance way to understand what's important. Priority provides a shared vocabulary without reading every card.

Adding priority levels to cards solves these problems by providing a simple, standardized signal of urgency that is visible both in the card detail view and on the board itself.

## Overview

Add a `priority` field to every card with five fixed levels:

| Level    | Meaning                                              |
| -------- | ---------------------------------------------------- |
| **None** | No priority set (default). Neutral.                  |
| **Low**  | Nice-to-have. Can be deferred or skipped.            |
| **Medium** | Standard importance. Should be completed normally. |
| **High** | Important. Should be addressed soon.                 |
| **Critical** | Urgent. Requires immediate attention.          |

Each level has an associated color and icon for quick visual identification. The `None` level serves as the default and allows cards that don't need prioritization to remain neutral.

This feature works on both **Project** and **Story** card types.

## Proposed Behavior

### Priority levels

| Level      | Value    | Color    | Icon              |
| ---------- | -------- | -------- | ----------------- |
| None       | `none`   | Gray     | Horizontal line   |
| Low        | `low`    | Blue     | Downward arrow    |
| Medium     | `medium` | Orange   | Right arrow       |
| High       | `high`   | Red      | Upward arrow      |
| Critical   | `critical`| Dark red | Upward double arrow |

Colors follow the Semantic UI color palette used elsewhere in the application.

### Default priority for new cards

New cards default to **None**. The creator may optionally set a priority at creation time. This avoids forcing users to make a priority decision on every card while still supporting priority from the start.

### Card detail view (modal)

Priority appears in the card modal in two places:

1. **Header area:** A compact priority badge appears near the card title (right side, adjacent to the card ID badge). The badge shows the priority icon and color. Clicking it opens a dropdown to change the priority.

2. **Sidebar "Add to card" / "Actions" section:** A "Priority" button allows the user to open the priority selector popup (matching the pattern of the existing "Due Date" and "Labels" buttons).

Priority is editable by board editors only. Viewers see the badge in read-only mode.

### Board / column view (card front)

A small colored indicator appears on the card front to signal priority at a glance:

- **Position:** Top-right corner of the card, near the member avatars. (Labels are rendered on the left side of the card; member avatars are on the right side. The priority indicator sits alongside the avatars.)
- **Appearance:** A small colored triangle or flag icon matching the priority color. When the card is viewed in list view, only the colored icon is shown (no text). Hovering reveals the priority level name as a tooltip.
- **None priority:** No indicator is shown on the card front (keeps the card clean when priority is not set).

### Sorting

Priority **does not** affect the default card sort order (position within a list). This preserves the user's drag-and-drop arrangement.

However, when a list is sorted using the existing sort controls, priority should be available as a sort option:

- Sort by priority: `Critical > High > Medium > Low > None`
- Sort by priority (reverse): `None > Low > Medium > High > Critical`

This is added alongside existing sort options (alphabetically, by creation time, by due date).

### Filtering

Priority is added as a filter option in the board's filter panel, alongside existing filters (members, labels). Users can:

- Filter by a single priority level (e.g., "Show only Critical cards")
- Clear the priority filter to return to all cards

**Note:** Unlike labels (which are board-scoped and stored in a join table `CardLabel`), priority is a global enum stored directly on the Card model. The client-side priority filter is simply a selector state (e.g., `selectedPriorityLevel` in the board filter reducer), not a join-table query. Cards are filtered client-side by matching `card.priority === selectedPriorityLevel`.

### Card creation

When creating a card via the inline "Add a card" input in a list, priority is not required. The user must open the card modal to set a priority, or use the API. This keeps the fast-add flow simple.

## Architecture & Technical Approach

### Approach: Enum string field on Card model

The priority is stored as a nullable string field on the `Card` model, using the same pattern as the existing `type` field:

```javascript
// server/api/models/Card.js
priority: {
  type: 'string',
  isIn: Object.values(Card.PriorityLevels),
  allowNull: true,
  defaultsTo: null,
  columnName: 'priority',
},
```

Where `Card.PriorityLevels` is defined as:

```javascript
const PriorityLevels = {
  NONE: 'none',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};
```

#### Why string enum, not integer?

| Criterion          | String enum (`none`/`low`/...) | Integer (`0`/`1`/`2`/`3`/`4`) |
| ------------------ | ------------------------------ | ------------------------------ |
| Readability        | Self-documenting in DB/API     | Requires external mapping      |
| Validation         | `isIn` constraint on values    | `min`/`max` + manual check     |
| Sort order         | Requires explicit mapping      | Natural numeric ordering       |
| API clarity        | Meaningful in JSON responses   | Opaque numbers                 |
| Migration simplicity | No conversion needed         | Would need mapping on read/write |
| Consistency        | Matches existing `type` field  | No precedent in this codebase  |

String enum is the clear winner and matches the existing `type` field pattern used on the Card model (`project`/`story`).

### Server implementation details

#### New field: `server/api/models/Card.js`

- Add `Card.PriorityLevels` constant object with the five levels.
- Add `priority` attribute as a nullable string with `isIn` validation against `Card.PriorityLevels`.
- Update the swagger `Card` schema to include the `priority` field with its enum values and description.

#### Migration: `server/db/migrations/YYYYMMDDHHMMSS_add_card_priority.js`

```sql
ALTER TABLE card ADD COLUMN priority VARCHAR(10) DEFAULT NULL;
```

- All existing cards get `NULL` (None), preserving their current state.
- The column uses `VARCHAR(10)` to accommodate the longest value (`critical`).

#### Controller updates

**`server/api/controllers/cards/create.js`:**
- Add `priority` input with `isIn: Object.values(Card.PriorityLevels)` and `allowNull: true`.
- Add `priority` to the `_.pick(inputs, [...])` values array passed to the create helper.
- Update swagger doc to include the `priority` parameter.

**`server/api/controllers/cards/update.js`:**
- Add `priority` input with `isIn: Object.values(Card.PriorityLevels)` and `allowNull: true`.
- Add `priority` to the `availableInputKeys` for editors.
- Add `priority` to the `_.pick(inputs, [...])` values array.
- Update swagger doc to include the `priority` parameter.

#### Helper updates

**`server/api/helpers/cards/update-one.js`:**
- Accept and pass through `priority` in the values.

**`server/api/helpers/cards/duplicate-one.js`:**
- Include `priority` in the `_.pick(inputs.record, [...])` array that copies card fields to the duplicate. This ensures duplicated cards retain the original priority.

#### Show response

The Card swagger schema (in `server/api/models/Card.js`) is updated to include `priority`. Since all card responses flow through the same model, this automatically covers:
- `GET /cards/{id}` (show)
- `POST /lists/{listId}/cards` (create)
- `PATCH /cards/{id}` (update)
- Board fetch payload (which includes cards)

No controller-level changes are needed for the response — the field is serialized by the model.

### Client implementation details

#### Card model: `client/src/models/Card.js`

- Add `priority: attr()` to the Redux-ORM fields.
- The `priority` field flows through existing upsert/reducer paths (board fetch, card create/update/duplicate). No new reducer cases are needed because priority is a simple attribute update on the Card.
- The `duplicate()` method explicitly enumerates every copied field (e.g., `name`, `description`, `dueDate`, `isDueCompleted`, `stopwatch`, `isClosed`). The `priority` field must be added to this enumeration so that duplicated cards retain the original priority.

#### Priority enum constants: `client/src/constants/Enums.js`

- Add `CardPriorityLevels` enum matching the server values:
  ```javascript
  export const CardPriorityLevels = {
    NONE: 'none',
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical',
  };
  ```

#### UI: Priority selector

A new component `SelectPriorityStep` (similar to `SelectCardTypeStep`) provides a dropdown popup for selecting a priority level. Each level is displayed with its icon and color.

**Placement in card modal:**

- **ProjectContent.jsx:** Add a "Priority" button in the sidebar "Add to card" section, alongside Due Date, Labels, Task List, etc.
- **StoryContent.jsx:** Same placement in the sidebar.

**Placement in card front:**

- **ProjectContent.jsx / StoryContent.jsx** (the card front components in `client/src/components/cards/Card/`): Render a small colored priority icon on the right side of the card front, near the member avatars. (Labels render on the left; avatars render on the right.)

#### Card update via priority selector

Changing priority dispatches `entryActions.updateCurrentCard({ priority: newValue })`, which follows the existing card update flow (no new API endpoints needed).

#### Locales: `client/src/locales/*/core.js`

- Add strings for:
  - `common.priority` (section/field title)
  - `common.priorityNone` / `common.priorityLow` / `common.priorityMedium` / `common.priorityHigh` / `common.priorityCritical` (level names)
  - `common.setPriority` (action label for sidebar button)
  - `action.setPriority` (popup title)

#### Board sort filter

The existing board sort functionality needs a new option. The sort control (likely in a board header or list header component) gains a "By priority" option that sorts cards by priority level.

## Affected Files

### Server

| Category   | File/Path                                              | Action       |
| ---------- | ------------------------------------------------------ | ------------ |
| Model      | `server/api/models/Card.js`                            | Modify       |
| Controller | `server/api/controllers/cards/create.js`               | Modify       |
| Controller | `server/api/controllers/cards/update.js`               | Modify       |
| Helper     | `server/api/helpers/cards/update-one.js`               | Modify       |
| Helper     | `server/api/helpers/cards/duplicate-one.js`            | Modify       |
| Migration  | `server/db/migrations/YYYYMMDDHHMMSS_add_card_priority.js` | **Create** |

### Client

| Category   | File/Path                                                          | Action       |
| ---------- | ------------------------------------------------------------------ | ------------ |
| Model      | `client/src/models/Card.js`                                        | Modify       |
| Constants  | `client/src/constants/Enums.js`                                    | Modify       |
| Component  | `client/src/components/cards/SelectPriority/index.js`              | **Create**   |
| Component  | `client/src/components/cards/SelectPriority/SelectPriorityStep.jsx` | **Create**   |
| Component  | `client/src/components/cards/SelectPriority/SelectPriorityStep.module.scss` | **Create** |
| Component  | `client/src/components/cards/PriorityBadge/index.js`               | **Create**   |
| Component  | `client/src/components/cards/PriorityBadge/PriorityBadge.jsx`      | **Create**   |
| Component  | `client/src/components/cards/PriorityBadge/PriorityBadge.module.scss` | **Create** |
| Component  | `client/src/components/cards/CardModal/ProjectContent.jsx`         | Modify       |
| Component  | `client/src/components/cards/CardModal/StoryContent.jsx`           | Modify       |
| Component  | `client/src/components/cards/Card/ProjectContent.jsx`              | Modify       |
| Component  | `client/src/components/cards/Card/StoryContent.jsx`                | Modify       |
| Locales    | `client/src/locales/*/core.js` (all locale directories)            | Modify       |

## Open Questions

1. **Default priority for new cards:** Should the default be `None` or `Medium`? `None` avoids forcing a decision and is the recommended starting point. Some teams may prefer `Medium` as the default so every card has a priority. This could be made configurable per board in the future.

2. **Configurable priority levels:** Should priority levels be fixed (`none`/`low`/`medium`/`high`/`critical`) or configurable per board? Fixed levels are simpler, ensure consistency across boards, and avoid the complexity of per-board configuration. Recommendation: fixed levels for v1.

3. **Priority on card creation flow:** Should the inline "Add a card" input in a list allow setting priority directly? This would add complexity to the fast-add flow. Recommendation: no — priority is set after creation via the card modal, keeping the inline flow simple.

4. **Priority sorting in board view:** Should "Sort by priority" be available as a default sort option, or only as an opt-in? The existing sort options are already present. Adding priority sorting is additive and follows the same pattern. Recommendation: include it as a standard sort option.

5. **Priority-based filtering:** Should priority filtering be available in the board-level filter panel? This is straightforward to add and aligns with existing label/member filters. Recommendation: include it in v1.

6. **Card transfer behavior:** When a card is transferred between boards, should its priority be preserved? Yes — priority is intrinsic to the card, not board-specific. Unlike task assignees (which are cleared if the user isn't on the target board), priority has no such dependency.

7. **API default value:** Should the API default to `null` (None) or a specific level? `null` is the server default, and the client interprets `null` as "None." This keeps the API clean and avoids requiring clients to know about the "None" level.

8. **Critical priority notifications:** Should cards marked as "Critical" trigger any special notifications or highlighting? This could be a future enhancement (e.g., daily digest of critical cards). Recommendation: out of scope for v1.

9. **Priority history:** Should priority changes be tracked in the card activity log? The current activity log tracks task completion, member changes, and card moves. A priority change action type (`UPDATE_CARD_PRIORITY`) could be added. Recommendation: optional for v1, can be added later if audit trail is requested.

10. **Bulk priority updates:** Should there be a way to set priority on multiple cards at once? Recommendation: out of scope for v1. Individual card updates are sufficient for the initial release.
