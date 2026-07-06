# Skeleton Tab — Manual/Agent Test Protocol

Scope: `frontend/javascripts/viewer/view/right_border_tabs/skeleton_tab/` — the right-sidebar
tab that lists skeleton trees and tree groups for an annotation, plus its toolbar, tree view,
context menus, and selection-details panel.

How to use this document: each test case has an ID, preconditions, steps, and expected result.
Cases are grouped by feature area so a run can be scoped to just the area that changed. "Setup"
notes at the top of each group describe the annotation state a case assumes; create it before
running the case if not already true.

General setup for the whole protocol:
- Open a skeleton (or hybrid) annotation in the viewer.
- Have at least 6 trees and a small group hierarchy (2 nested groups, one empty group) ready to
  restore between test groups, e.g. via importing a prepared NML.
- Know one account with edit rights and one read-only view (public link or teammate without edit
  rights) to exercise disabled states.

---

## 0. Entry / Empty States

| ID | Preconditions | Steps | Expected Result |
|----|---------------|-------|------------------|
| 0.1 | Annotation has no skeleton layer | Open the annotation, switch to skeleton tab | Tab shows "This annotation does not contain a skeleton layer. You can add one in the Layers tab in the left sidebar." No toolbar rendered. |
| 0.2 | Skeleton layer exists, 0 trees, 0 groups | Open skeleton tab | Toolbar is rendered; body shows "There are no trees in this annotation. A new tree will be created automatically once the first node is placed." (Empty.PRESENTED_IMAGE_SIMPLE) |
| 0.3 | `showSkeletons` is false (skeleton layer visibility toggled off elsewhere, e.g. Layers tab) | Open skeleton tab | Yellow warning icon appears below the toolbar divider; hovering shows tooltip "Skeletons are hidden" (or equivalent localized message). |
| 0.4 | Tab was hidden (e.g. another right-sidebar tab active), then switched back | Switch away from and back to the skeleton tab | Content re-renders correctly (via `DomVisibilityObserver`); no stale/duplicated tree view, scroll position/selection preserved. |

---

## 1. Toolbar — Basic Actions

Setup: annotation with edit rights, at least 2 trees, at least 1 group.

| ID | Steps | Expected Result |
|----|-------|------------------|
| 1.1 | Click "Create new Tree" (+ icon) | A new empty tree is created and becomes the active tree; appears at root level; tree list scrolls to/highlights it. |
| 1.2 | Press keyboard shortcut `C` while skeleton tab has focus / viewport focused | Same as 1.1 (new tree created). |
| 1.3 | Click "Create new Group" (folder+ icon) | New group named "Group {n}" created at root level, auto-selected/active; appears in tree list. |
| 1.4 | Select a single tree, click Delete (trash icon) | Tree is deleted immediately (no confirmation, since only 1 tree). Selection clears. |
| 1.5 | Select 3 trees (ctrl/cmd-click), click Delete | Confirmation modal "Delete all selected trees?" mentioning count of 3 appears. Confirm → all 3 deleted, selection cleared. Cancel → nothing deleted. |
| 1.6 | Activate a group (click it) with no trees selected, click Delete | Group deletion flow triggers (see §6 Group Deletion) instead of tree deletion. |
| 1.7 | On a **task** annotation, select a tree containing the node with id `1` (initial node), click Delete | Extra confirmation "Deleting a tree with the initial node. Are you sure?" appears before deletion proceeds. Cancel aborts deletion. |
| 1.8 | Click "Toggle Visibility of All Trees" (icon) | All trees toggle visibility together (all become hidden if any were visible, or all visible if all were hidden — verify exact toggle semantics against current behavior). Checkbox states in tree view update accordingly. |
| 1.9 | Press `1` | Same effect as 1.8. |
| 1.10 | Make one tree active, click "Toggle Visibility of Inactive Trees" | All trees except the active one toggle visibility; active tree's own visibility is unaffected. |
| 1.11 | Press `2` | Same effect as 1.10. |
| 1.12 | Click "Select previous tree" (←) repeatedly | Active tree cycles backward through the (sorted) tree list; tree view scrolls/highlights each step; wraps around at the start. |
| 1.13 | Click "Select next tree" (→) repeatedly | Active tree cycles forward; wraps at the end. |
| 1.14 | Repeat 1.12/1.13 while logged in as a **read-only** viewer | Buttons remain enabled and functional (not gated by `allowUpdate`). |

### 1.15 Read-only / locked-annotation gating

| ID | Steps | Expected Result |
|----|-------|------------------|
| 1.15.1 | Open the same annotation as a user without edit rights (or a locked annotation) | Create Tree, Create Group, Delete, Toggle-All, Toggle-Inactive, Shuffle Colors, Import NML buttons are all disabled; tooltips explain read-only reason (locked vs. not owner vs. no permission, per `messages["tracing.read_only_mode_notification"]`). Search, prev/next tree buttons remain enabled. |
| 1.15.2 | Attempt drag-and-drop, inline rename, context-menu edit actions while read-only | All are disabled/no-ops (drag disabled entirely; rename fields not editable; context menu edit items disabled). |

---

## 2. Toolbar — Search

Setup: tree/group names with a distinguishing substring, e.g. "Axon_1", "Axon_2", "Dendrite_1", spread across nested groups.

| ID | Steps | Expected Result |
|----|-------|------------------|
| 2.1 | Click the search icon | Search popover opens with a text input. |
| 2.2 | Press `Ctrl+Shift+F` (`Cmd+Shift+F` on Mac) anywhere the shortcut is scoped | Search popover opens/focuses, same as 2.1. |
| 2.3 | Type "Axon" | Popover lists matching trees and groups (by name) live as you type. |
| 2.4 | Click a matching tree result whose parent group is currently collapsed | Parent group(s) auto-expand; that tree becomes active and is scrolled into view/highlighted. |
| 2.5 | Click a matching group result | That group becomes active (highlighted); ancestor groups auto-expand. |
| 2.6 | With multiple matches for "Axon", use "select all matching" | All matching **trees** (groups excluded) become multi-selected; their ancestor groups auto-expand. |
| 2.7 | Search for a string with zero matches | Popover shows an empty/no-results state; no crash. |
| 2.8 | Close popover (Escape or click outside) and reopen | Previous query is cleared or preserved consistently (verify actual behavior, note if surprising). |

---

## 3. Toolbar — More Actions Menu

| ID | Steps | Expected Result |
|----|-------|------------------|
| 3.1 | Open "More actions" (☰ icon), open "Sort" submenu | Two options "by name" / "by creation time" shown; the currently active sort is marked/highlighted. |
| 3.2 | Select "by name" | Tree list re-sorts: within each group, trees and groups interleave alphabetically. Setting persists (check it survives tab switch / reload). |
| 3.3 | Select "by creation time" | Groups sort to the top of each level (by name), trees below sorted by creation timestamp ascending. |
| 3.4 | Click "Shuffle All Tree Colors" | Every tree's color changes to a new randomized RGB; color dots in tree view update; disabled when read-only. |
| 3.5 | Click "Download Visible Trees as NML" | "Preparing NML" modal with spinner appears, then a `.nml` file download is triggered; modal closes automatically after. |
| 3.6 | With an active geometry transform applied to the dataset, reopen menu | An extra "Download Visible Trees NML (Transformed)" entry appears; tooltip clarifies the active transform will be applied per-node. |
| 3.7 | Click the transformed-NML download | Downloaded NML's node coordinates reflect the transform (spot-check a known node's coordinates vs. untransformed download). |
| 3.8 | Click "Download Visible Trees as CSV" | "Preparing CSV" modal appears; a `tree_export.zip` downloads containing `trees.csv`, `nodes.csv`, `edges.csv` (unzip and check row counts/columns roughly match tree/node/edge counts). |
| 3.9 | With active transform, click transformed CSV download | Same as 3.7 but for CSV node coordinates. |
| 3.10 | While an export is in progress, watch the modal title | Title stays as "Preparing NML" or "Preparing CSV" (matching the export that was started) throughout the fade-out, doesn't flicker to the other type if you rapidly trigger both. |
| 3.11 | Click "Import NML" | Opens the dropzone/import modal (separate component) rather than a native file picker directly. |
| 3.12 | Click "Measure Length of All Skeletons" | A notification appears with the total skeleton length in both physical units and voxels. |
| 3.13 | Trigger CSV export with dev tools offline/simulated network failure during zip creation | Toast error "Could not export trees. See the console for details." shown; modal closes; no partial/corrupt download. |

---

## 4. Tree View — Rendering & Structure

Setup: hierarchy with ≥2 nesting levels, one empty group, one group containing only subgroups (no direct trees), one AGGLOMERATE-type tree, one tree with metadata attached.

| ID | Steps | Expected Result |
|----|-------|------------------|
| 4.1 | Inspect a tree row | Shows: colored dot (tree color), node count in parentheses, editable name label, and (if AGGLOMERATE type) a proofreading icon with tooltip "Agglomerate Tree", and (if metadata present) a tags icon with tooltip "This tree has assigned metadata properties." |
| 4.2 | Inspect a group row | Shows folder icon + editable name; empty-named group displays placeholder "<Unnamed Group>". |
| 4.3 | Load the tab fresh | All groups start expanded (`defaultExpandAll`). |
| 4.4 | Click a group's expand/collapse chevron | Only that group's direct view toggles; state persists across tab switches (backed by `TreeGroup.isExpanded` in Redux, so also persists across save/reload). |
| 4.5 | Collapse a group that has expanded subgroups, then re-expand it | Verify whether subgroups return to their previous expanded state or reset — capture actual behavior, since only *manual* collapse-all propagates to descendants (see 6.x). |
| 4.6 | Load a very large tree list (100+ trees) | List remains responsive; virtualization (`ScrollableVirtualizedTree` + `AutoSizer`) keeps scrolling smooth; only visible rows are in the DOM (verify via inspector). |
| 4.7 | Select a tree, then use viewport/keyboard elsewhere to change the active tree (e.g. click a node in the 3D view belonging to a different tree) | Tree view auto-scrolls to and highlights the newly active tree; if it's inside a collapsed group, that group auto-expands. |
| 4.8 | Immediately after opening the tab (mount), with an already-active tree deep in a collapsed group | After ~1s, view scrolls to and reveals the active tree without user interaction. |
| 4.9 | Make a group active (not via tree) | Tree view scrolls to and highlights that group row. |
| 4.10 | Toggle a tree's visibility checkbox | Only that tree's checkbox changes; `toggleTreeAction` fires; 3D viewport reflects the change. |
| 4.11 | Toggle a group's visibility checkbox (group has trees, all currently visible) | All trees within that group (and subgroups) become hidden in one action; checkbox becomes unchecked. |
| 4.12 | Toggle visibility checkbox on the root's virtual group row / "select all" boundary case | Behaves as toggle-all for every tree in the annotation. |
| 4.13 | Inspect an empty group's checkbox | Checkbox is disabled (`disableCheckbox: true`) — cannot be (un)checked. |
| 4.14 | Have a group with mixed child visibility (some trees visible, some not) | Group checkbox shows an indeterminate/unchecked state consistent with "all children visible" logic — verify it is NOT shown as fully checked. |
| 4.15 | Nest a group with only subgroups containing trees (no direct trees of its own) | `containsTrees` is still true and its aggregate visibility state reflects descendants correctly. |

---

## 5. Selection Behavior

Setup: ≥6 trees at the same nesting level under one group, so range-select has siblings to work with.

| ID | Steps | Expected Result |
|----|-------|------------------|
| 5.1 | Click tree A | Tree A becomes active and singly selected (highlighted); previous selection cleared. |
| 5.2 | Click tree A, then Ctrl/Cmd-click tree B | Both A and B are selected (multi-select highlight); neither is uniquely "active" per se — selection details show "2 Trees selected." |
| 5.3 | With A+B selected, Ctrl/Cmd-click B again | B is removed from selection; A remains selected and becomes active again (single-select state restored). |
| 5.4 | With A+B+C selected, Ctrl/Cmd-click C | C removed; A+B remain multi-selected (no auto single-select promotion since 2 remain). |
| 5.5 | With A active (singly selected), Ctrl/Cmd-click B (B not yet selected) | Both A and B become selected; the previously-active designation on A is cleared (now just "selected", not "active"). |
| 5.6 | With nothing selected/active, Ctrl/Cmd-click tree D | D becomes selected (single multi-select entry). |
| 5.7 | Click tree A (active), then Shift-click tree D (further down, same parent group) | All trees between A and D inclusive (by current sort order) become selected. |
| 5.8 | Shift-click when no tree is currently active | No range select occurs (shift-click requires an active tree as the anchor) — verify graceful no-op, not a crash. |
| 5.9 | Shift-click a tree in a **different** group than the active tree | Range select does not cross group boundaries — verify behavior matches "only works within same parent group" and doesn't silently select unrelated trees. |
| 5.10 | Use search "select all matching" (see 2.6) while trees are already individually selected | Prior selection is replaced by the full match set. |
| 5.11 | With ≥2 trees multi-selected, click on a group row | Confirmation modal "Do you really want to select this group? This will deselect all selected trees." appears, showing count. Confirm → group becomes active, tree selection cleared. Cancel → selection unchanged, group not activated. |
| 5.12 | With 0 or 1 tree selected, click a group row | Group activates immediately, no confirmation modal. |
| 5.13 | With a group active, click a single tree | Group deselects/deactivates; tree becomes active as normal. |
| 5.14 | Delete the currently active tree via keyboard/API from elsewhere in the app while multiple are selected in this tab | Verify selection state doesn't reference a stale/deleted tree id (no crash on next render). |

---

## 6. Group Operations

### 6.1 Create Group

| ID | Steps | Expected Result |
|----|-------|------------------|
| 6.1.1 | Toolbar "Create new Group" with nothing active | New group "Group {n}" created at root level; becomes active; selection cleared. |
| 6.1.2 | Right-click an existing group → "Create new group" | New child group created *inside* that group (not at root); parent auto-expands if collapsed. |
| 6.1.3 | Create several groups in a row | Each gets a unique incrementing numeric suffix, no collisions even after deleting one in between (verify id reuse policy — "next available" vs "always increasing"). |

### 6.2 Rename Group / Tree (inline editing)

| ID | Steps | Expected Result |
|----|-------|------------------|
| 6.2.1 | Double-click a tree's name label | Enters edit mode (text input); dragging that row is disabled while editing. |
| 6.2.2 | Type a new name and press Enter | Name commits; `setTreeNameAction` fires; label updates immediately. |
| 6.2.3 | Type a new name and click elsewhere (blur) | Same commit behavior as Enter. |
| 6.2.4 | Enter edit mode, type something, press Escape | Edit is cancelled, original name restored, no dispatch fired. |
| 6.2.5 | Double-click a group's name label, rename it | Commits via `api.tracing.renameSkeletonGroup` (async); label updates; verify no visible lag/flicker, and errors (e.g. network failure) are surfaced rather than silently dropped. |
| 6.2.6 | Rename a group to an empty string | Falls back to displaying "<Unnamed Group>" without crashing; underlying stored name reflects the empty/trimmed value. |
| 6.2.7 | Start renaming a tree, then attempt to drag it before committing | Drag is blocked (renamingCounter > 0) — row does not become draggable mid-edit. |
| 6.2.8 | Attempt to double-click to rename while read-only | Edit mode does not activate, or input is non-editable. |

### 6.3 Delete Group

| ID | Steps | Expected Result |
|----|-------|------------------|
| 6.3.1 | Delete an **empty** group (no children, no trees) via toolbar delete or context menu | Deletes immediately without any confirmation modal. |
| 6.3.2 | Delete a **non-empty** group (has trees and/or subgroups) | `DeleteGroupModalView` appears with message about children being moved to the parent level if "keep children" is chosen; two buttons: "Remove group including all children" (danger/red) and "Remove group and keep children" (primary). |
| 6.3.3 | In that modal, click "Remove group and keep children" | Group is removed; its direct child trees and subgroups move up to the deleted group's former parent (root if it was top-level); nothing is actually deleted content-wise. |
| 6.3.4 | In that modal, click "Remove group including all children" | Group **and** all descendant trees/subgroups are permanently deleted. |
| 6.3.5 | Click the modal's "Cancel" / X | No changes made; group remains intact. |
| 6.3.6 | Delete the **root** ("select all"/virtual root) via a whole-tree-clearing action, if exposed in the UI | Distinct confirmation: "Do you want to delete all trees and groups?" with a danger-styled OK button; confirming clears the entire annotation's trees and groups. |
| 6.3.7 | Delete a non-empty group where one contained tree has the initial task node (id 1) on a task annotation | Additional "Deleting a tree with the initial node. Are you sure?" confirmation appears before the group deletion proceeds, for either delete-mode. |
| 6.3.8 | Delete a group while it (or a descendant) is the active group / contains actively-selected trees | Selection/active state is cleared cleanly afterward, no dangling references or console errors. |

### 6.4 Expand/Collapse Subgroups (bulk)

| ID | Steps | Expected Result |
|----|-------|------------------|
| 6.4.1 | Right-click a group that has ≥1 child group → "Collapse all subgroups" | That group and all nested descendant groups collapse in one action. |
| 6.4.2 | Right-click the same group → "Expand all subgroups" | All nested descendant groups re-expand. |
| 6.4.3 | Right-click a group with **no** child groups (only trees or empty) | Neither "Collapse all subgroups" nor "Expand all subgroups" menu items are shown. |

---

## 7. Drag and Drop

Setup: at least 2 groups (one nested inside the other), several trees at root and inside groups, and one tree not yet in any group.

| ID | Steps | Expected Result |
|----|-------|------------------|
| 7.1 | Drag a single tree onto a group | Tree moves into that group (`setTreeGroupAction`); target group auto-expands if it was collapsed; tree row now nests under the target. |
| 7.2 | Drag a tree onto another tree that belongs to group G | Dragged tree moves into group G (i.e., dropping "on" a tree reparents into that tree's containing group), not literally nested under the tree. |
| 7.3 | Drag a tree onto the root/background area (outside any group) | Tree moves to the root level (ungrouped). |
| 7.4 | Multi-select 3 trees (ctrl-click), then drag one of the selected trees onto a group | All 3 selected trees move into the target group together, not just the one dragged. |
| 7.5 | Multi-select 2 trees, then drag a **different**, unselected tree onto a group | Per documented behavior, the dragged tree is included alongside the existing selection (all move together) — verify this is not confusing/unexpected in practice; flag if it surprises a first-time user. |
| 7.6 | Drag a group onto another group | Source group (with all its children) becomes a child of the target group; target auto-expands. |
| 7.7 | Drag a group onto its own child/descendant group | Verify this is prevented or safely no-ops (must not corrupt the hierarchy into a cycle or freeze the UI). |
| 7.8 | Drag a group onto itself | No-op, no crash. |
| 7.9 | Drag a tree that's already directly in group G back onto group G (or a sibling tree in G) | No-op / same position, no error. |
| 7.10 | Attempt to drag the implicit root row | Root is not draggable (`isRootGroupNode` check) — no drag initiates. |
| 7.11 | Start renaming a tree/group (inline edit active), attempt to drag it | Drag does not initiate while `renamingCounter > 0`. |
| 7.12 | Attempt any drag while read-only / annotation locked | Drag is disabled entirely (`allowUpdate` false ⇒ `nodeDraggable` false for all rows). |
| 7.13 | Drag a tree from deep inside a collapsed group's hidden descendant area (i.e., drag while scrolled, virtualization active) | Drag-and-drop still works correctly across virtualized/scrolled rows — no offset/target miscalculation. |
| 7.14 | After any successful drop, check tree/group counts and 3D viewport | No trees/nodes are lost or duplicated; underlying geometry/rendering still matches the tree's group/visibility state. |
| 7.15 | Perform a drag-and-drop, then Undo (Ctrl+Z) | The move is undone (verify the reparenting is tracked by the undo/redo history), tree/group returns to prior position. |

---

## 8. Context Menus

### 8.1 Tree Context Menu

Setup: right-click a normal tree, and separately an AGGLOMERATE-type tree.

| ID | Steps | Expected Result |
|----|-------|------------------|
| 8.1.1 | Right-click a tree row | Context menu opens near cursor with items: Change Tree Color, Shuffle Tree Color, Duplicate Tree, Delete Tree, Measure Tree Length, Hide/Show All Other Trees, Hide/Show Edges of This Tree, (Convert to Normal Tree only if AGGLOMERATE). |
| 8.1.2 | "Change Tree Color" → pick a color in the inline picker | `setTreeColorAction` fires with the chosen RGB; dot in tree row updates live. |
| 8.1.3 | "Shuffle Tree Color" | Tree gets a new random color; menu closes. |
| 8.1.4 | "Duplicate Tree" | New tree created with the same nodes/edges, name suffixed " (copy)"; original untouched; menu closes. |
| 8.1.5 | "Delete Tree" | Tree deleted immediately (single-tree delete path, same as toolbar for 1 selected); selection cleared; menu closes. |
| 8.1.6 | "Measure Tree Length" | Notification with tree name, length in physical units, and length in voxels appears; menu closes. |
| 8.1.7 | "Hide/Show All Other Trees" | This tree becomes active; all *other* trees toggle visibility (equivalent to toolbar's toggle-inactive but scoped by right-click target); menu closes. |
| 8.1.8 | "Hide/Show Edges of This Tree" | This tree becomes active; only its edges toggle visibility (nodes remain visible); verify in 3D viewport; menu closes. |
| 8.1.9 | Right-click an AGGLOMERATE tree → "Convert to Normal Tree" | Tree type changes to DEFAULT; agglomerate/proofreading icon disappears from the row; menu closes. |
| 8.1.10 | Right-click while read-only | Color, shuffle, duplicate, and delete items are disabled; measure/hide/convert-type items still work if they don't require edit rights (verify each individually). |
| 8.1.11 | Right-click near the viewport edge/bottom of the list | Menu positions itself fully on-screen, not clipped/off-canvas. |
| 8.1.12 | On Windows, rapid right-click on two different trees in succession | Menu correctly switches target/content without leftover state from the previous target (covers the `setTimeout(0)` delayed-open behavior). |

### 8.2 Group Context Menu

Setup: right-click a group that has children, an empty group, and the case with something else currently active (a tree or another group).

| ID | Steps | Expected Result |
|----|-------|------------------|
| 8.2.1 | Right-click a group with children | Menu shows: Create new group, Move active [tree/trees/group] here (conditional), Delete group, Collapse/Expand all subgroups (conditional on having child groups), Hide/Show all other trees, Shuffle Tree Group Colors, Change Tree Group Color. |
| 8.2.2 | "Create new group" | New child group created inside the right-clicked group (see 6.1.2). |
| 8.2.3 | With 1+ trees multi-selected elsewhere, right-click a different group → "Move active trees here" | Label says "trees" (plural where applicable); all selected trees move into this group. |
| 8.2.4 | With a single active tree (no multi-select), right-click a group → "Move active tree here" | That single tree moves into the group. |
| 8.2.5 | With an active group (not a tree), right-click a different group → "Move active group here" | The active group (with its children) is reparented under the right-clicked group. |
| 8.2.6 | With nothing active/selected, right-click a group | "Move active ... here" item is absent entirely. |
| 8.2.7 | Try to move the active group onto **itself** via this menu item | Verify safe no-op (matches drag-and-drop self-drop protection expectations from 7.8). |
| 8.2.8 | "Delete group" | Triggers the same deletion flow as §6.3 (immediate for empty, modal for non-empty). |
| 8.2.9 | "Collapse all subgroups" / "Expand all subgroups" | Same as §6.4, accessible via context menu as well as via a group with subgroups. |
| 8.2.10 | Right-click a group with no child groups | Collapse/Expand-all-subgroups items are absent. |
| 8.2.11 | "Hide/Show all other trees" on a group | Group becomes active; all trees NOT inside this group toggle visibility; trees inside the group are unaffected. |
| 8.2.12 | "Shuffle Tree Group Colors" | Every tree inside this group and all its subgroups gets a new random color, in one undo-step (batched); verify Undo reverts all of them together, not one-by-one. |
| 8.2.13 | Right-click the "select all"/root-equivalent group scope → "Shuffle Tree Group Colors" | Equivalent to toolbar "Shuffle All Tree Colors" (`shuffleAllTreeColorsAction`). |
| 8.2.14 | "Change Tree Group Color" → pick a color | All trees in the group + subgroups get set to that exact color, batched into one undo step. |
| 8.2.15 | Same on the root scope | Equivalent to setting every tree in the annotation to that color. |
| 8.2.16 | Right-click while read-only | Create, Move-here, Delete, Change-Group-Color items disabled; Collapse/Expand and Hide-others may remain enabled if they don't mutate persisted data — verify actual gating per item. |

---

## 9. Selection Details Panel (bottom pane)

Setup: resizable split pane between tree view and details panel.

| ID | Steps | Expected Result |
|----|-------|------------------|
| 9.1 | Select exactly one tree | Details panel shows a table: ID (read-only), Name (editable input), and any metadata rows via `MetadataEntryTableRows`. |
| 9.2 | Edit the Name field in the details panel and blur | `setTreeNameAction` fires; tree row's label updates to match; consistent with inline rename in the tree view (6.2). |
| 9.3 | Add/edit/remove a metadata property in the details panel | `setTreeMetadataAction` fires; tags icon appears/disappears next to the tree name in the tree view depending on whether metadata is non-empty. |
| 9.4 | Select 2+ trees | Panel shows plain text "N Trees selected." (pluralized correctly for N=2 vs N=1 edge check), no metadata/name editing UI. |
| 9.5 | Activate a group (no trees selected) | Panel shows group details: ID, editable Name, and Tree Count. |
| 9.6 | Group has no subgroups | Single "Tree Count" row showing direct tree count. |
| 9.7 | Group has subgroups | Two rows: "Tree Count (direct children)" and "Tree Count (all children)" — verify the "all children" sum correctly includes nested subgroup trees recursively. |
| 9.8 | Edit group Name in the details panel and blur | Calls `api.tracing.renameSkeletonGroup`; tree view label updates; consistent with 6.2.5. |
| 9.9 | Deselect everything (no tree selected, no group active) | Panel renders nothing (empty). |
| 9.10 | Resize the split pane divider between tree view and details panel | Both panes resize proportionally; layout doesn't break/overflow. |
| 9.11 | Attempt to edit Name/metadata fields while read-only | Fields render read-only (disabled inputs), no dispatch occurs. |

---

## 10. Import (NML / Protobuf / ZIP)

Setup: prepare sample files: valid `.nml`, valid `.zip` containing an NML, a `.zip` containing both NML and volume data (for an annotation that has an editable volume layer), a corrupted/garbage file, and a large NML (many trees) for performance.

| ID | Steps | Expected Result |
|----|-------|------------------|
| 10.1 | Toolbar → More actions → "Import NML" | Dropzone/import modal opens (not a raw OS file picker). |
| 10.2 | Drop/select a valid `.nml` file, "create group per file" unchecked | Trees and groups from the file are added to the existing hierarchy, merged at their original nesting (not wrapped in an extra group). |
| 10.3 | Same, with "create group per file" checked | All imported trees/groups are wrapped inside one new group named after the file. |
| 10.4 | Import multiple files at once, "create group per file" checked | Each file's contents get its own wrapper group; no cross-contamination between files' trees. |
| 10.5 | Import a `.nml` that also contains volume/segmentation info | Trees import normally; a warning toast appears: "The NML file contained volume information which was ignored…" (exact wording may vary — verify presence of a warning). |
| 10.6 | Import a valid `.zip` containing only an NML | Behaves like 10.2 (unzipped and parsed as NML), no volume warning duplicated. |
| 10.7 | Import a `.zip` containing NML + volume data, target annotation **has** an editable volume layer and an active segmentation tracing | Both skeleton trees AND the volume/segmentation data import; buckets reload; largest segment id updates appropriately. |
| 10.8 | Same `.zip`, but the annotation has **no** editable volume layer / no active segmentation tracing | Volume import fails gracefully with a user-facing error message (`VolumeImportError`); skeleton trees still import if the code path allows partial success, or the whole import is rejected — verify actual behavior and that no half-imported/corrupt state results. |
| 10.9 | Import a corrupted/garbage file (not NML, not protobuf, not zip) | Parser cascade fails for all formats; a toast error is shown ("could not be parsed" or similar); nothing is added to the hierarchy. |
| 10.10 | Import several files where some succeed and one fails to parse | Per documented "all-or-nothing" behavior: if ANY file errors, nothing is imported and all errors are shown as toasts — verify this all-or-nothing guarantee holds (no partial import of the successful files). |
| 10.11 | Import a large NML (e.g. 500+ trees) | Import completes without freezing the UI for an unreasonable time; resulting tree view still scrolls smoothly (virtualization holds up). |
| 10.12 | Import a `.nml` with a `.zip` extension or vice versa (extension/content mismatch) | Parser cascade (tries multiple formats regardless of extension) still successfully parses based on actual content, or fails gracefully — verify no crash. |
| 10.13 | Import trees containing user bounding boxes | Bounding boxes are added to the annotation's user bounding boxes (`addUserBoundingBoxesAction`) alongside the trees. |

---

## 11. Undo/Redo Coverage

Cross-cutting — re-verify for a sample of actions from other sections. Redux history should treat each of the following as a coherent single undo step (not partially undo-able):

| ID | Action performed | Steps | Expected Result |
|----|---|-------|------------------|
| 11.1 | Multi-tree delete (1.5) | Delete 3 selected trees, then Ctrl+Z | All 3 trees restored in one undo. |
| 11.2 | Group delete "including children" (6.3.4) | Delete a group+children, then Ctrl+Z | Group and all its children restored together. |
| 11.3 | Group delete "keep children" (6.3.3) | Ungroup via delete, then Ctrl+Z | Group re-created and children moved back into it in one step. |
| 11.4 | Drag multi-select move (7.4) | Move 3 trees via drag, then Ctrl+Z | All 3 return to their original group in one step. |
| 11.5 | Shuffle group colors (8.2.12) | Shuffle colors for a group of N trees, then Ctrl+Z | All N trees' colors revert together. |
| 11.6 | Set group color (8.2.14) | Apply one color to a group of N trees, then Ctrl+Z | All N trees revert to their individual prior colors. |
| 11.7 | Import (§10) | Import a file with several trees, then Ctrl+Z | All imported trees/groups are removed in one step. |

---

## 12. Cross-Feature / Regression Checks

| ID | Steps | Expected Result |
|----|-------|------------------|
| 12.1 | Perform a rename, then immediately drag the same row before any debounce/blur completes | No race condition: either the rename commits first or drag is correctly blocked; no lost edits. |
| 12.2 | Rapidly click "next tree" while a rename input is focused on another row | Renaming row's edit state doesn't leak/carry over to the new active tree row. |
| 12.3 | Switch to another right-sidebar tab and back mid-drag (if possible) or mid-context-menu | No leftover context menu overlay or stuck drag state after returning. |
| 12.4 | Toggle "sort by name" ↔ "sort by creation time" while a multi-select or active group is set | Selection/active state survives the re-sort/re-render without pointing at the wrong node. |
| 12.5 | Perform search, select a result, then immediately use Shift-click range-select | Range-select anchors correctly off the newly active tree from the search selection. |
| 12.6 | Open the tab on a very small viewport (narrow sidebar) | Toolbar wraps (`Space wrap`) rather than overflowing/clipping; all buttons remain clickable. |
| 12.7 | Load an annotation with deeply nested groups (5+ levels) | Indentation renders correctly and remains readable/functional at depth; drag-and-drop between distant levels still works. |
| 12.8 | With annotation locked by another user (not just read-only, but explicitly locked), verify all gating from §1.15 | Same disabled-state behavior, tooltip explains "locked by [owner]" specifically vs. generic no-permission message. |

---

## Notes for an automated/agent runner

- Most state changes are visible via: (a) the tree row's rendered text/icons, (b) the selection-details panel, (c) toast/notification content, (d) triggered file downloads, and (e) the 3D viewport (for visibility/color changes) — prefer asserting on (a)/(b)/(c) where possible since they're stable DOM queries.
- Redux action names referenced throughout (e.g. `setTreeGroupAction`, `deleteTreesAction`, `setTreeColorAction`) can be used to assert on dispatched actions if running inside a test harness with store access, rather than only asserting on final DOM state.
- Confirmation modals to watch for: delete-multiple-trees, delete-group (children choice), delete-initial-node, delete-root/select-group-while-multiselected. Each has distinct copy — assert on the exact modal title/message to avoid conflating them.
- Read-only/locked-annotation gating should be run as a full pass through every action once with an edit-capable user and once with a read-only/locked context, since disabling is implemented per-button rather than as one blanket switch.
