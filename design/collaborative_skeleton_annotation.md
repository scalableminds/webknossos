# Collaborative Skeleton Annotation via Tree Ownership

Status: draft / discussion doc
Scope: concurrent editing of one skeleton annotation by several users (and by several tabs of the same user) in live collaboration ("simultaneous editing"), including undo/redo. Brushing and proofreading keep their current behavior and are out of scope, except where group hierarchies are shared with segments.

## 1. Goal

Several users should be able to annotate skeletons in the same annotation at the same time. Eventually, every user should have a working undo/redo for their own edits.

## 2. Current state

- In live collaboration, only agglomerate trees (proofreading) may be edited (`mayEditSkeletonTree` in `annotation_accessor.ts`).
- Undo/redo is disabled in live collaboration (`undo.no_undo_in_live_collab`).
- Skeleton undo snapshots the whole `SkeletonTracing` and restores it (`undo_saga.ts`).
- Tree groups are saved by replacing the whole hierarchy (`updateTreeGroups`). Segment groups already have granular actions (`upsertSegmentGroup`, `deleteSegmentGroup`).
- The backend can reserve IDs for the domains `Tree`, `Node` and `TreeGroup`, but the frontend only uses reservations for `SegmentGroup` and `BoundingBox` (`id_reservation_saga.ts`).
- Fetched update actions carry `actionAuthorId`.

## 3. Why not ephemeral per-tree locks

A lock that can be released and acquired by someone else breaks undo: my local undo history may contain changes to a tree that is now locked by another user. Undo would then have to either fail or override the other user's work.

## 4. Core idea

- **Trees are complex graph structures**, so concurrent edits on the same tree are avoided altogether: only the owner (creator) of a tree may edit it. Ownership is per *user* and never changes (for now). Owning by session would not work: reopening the annotation creates a new session, which would lock the user out of their own trees.
- **Several sessions of the same user** could still edit the same tree. This case is rare, so it is resolved by locking out the session that would have to merge (§6).
- **Group hierarchies are simple**, so they have no owner. They are edited with granular actions, and undo uses inverse operations that only apply if the state still matches (§7, §8).

## 5. Tree ownership

- Add an owner user ID to the `Tree` proto.
- The backend sets it when handling `createTree`, from the authenticated user. Client-supplied values are ignored.
- Trees without an owner (created before this change) are owned by the annotation owner.
- In live collaboration, the backend rejects every skeleton update action that touches a tree owned by another user. This covers nodes, edges, branch points, comments, metadata, name, color, group assignment and deleting the tree.
- Cross-tree actions (merge trees, move nodes between trees, …) are only allowed if the user owns every tree involved.
- The frontend mirrors these checks so that tools and context menus are disabled for foreign trees instead of failing on save.

Not affected:
- Per-user state such as tree visibility (`SkeletonUserStateProto`). "Last write wins" is fine.
- Proofreading agglomerate trees. They keep their mutex-based behavior.
- Annotations outside live collaboration. Users take turns there, so the snapshot-based undo keeps working.

## 5a. Ids of new trees, nodes and tree groups

In live collaboration, ids must not collide between users. They are reserved on the server per user (`reserveIds`):

- Each session keeps a pool of reserved ids per domain (`Tree`, `Node`, `TreeGroup`) that is refilled in the background when it runs low.
- The reducers take ids synchronously from the pool, so creating nodes and trees stays synchronous (also for the scripting API).
- Bulk creations (loading agglomerate trees, syncing them after proofreading) reserve exactly as many ids as they need before creating anything.
- Used reservations are never reused, even if the item is deleted later.

**Open:** if items are created faster than the pool is refilled, the creation is ignored (with a toast). Whether creation should become async instead is decided later.

## 6. Several sessions of the same user: lockout

A session never fetches its own saved updates again, since its version is already past them. So a fetched update whose `actionAuthorId` is the current user must come from another tab or window of the same user.

**Rule:** when a session fetches (during rebase or version polling) a skeleton-tree-related update action authored by the current user, it

1. does not apply the fetched updates and never saves its pending changes (they are lost),
2. becomes read-only with the message: "This annotation was edited in another tab or window. Continue there, or reload this page to edit here." and a reload button.

This reuses the mechanism that already locks a session when another user reverts the annotation.

Notes:
- Only tree-related actions (nodes, edges, trees, tree groups, …) trigger the lockout. Brushing and proofreading have neither owner-only editing nor undo/redo, so they don't need it.
- Only one session is locked out: the session that saved first never fetches an update from the other one, because the other one has to rebase before it can save, and that rebase locks it out.
- A tab that was merely open is also locked out once it polls the other tab's save. Effectively, there is only one tab per user that edits skeletons.
- Rebasing therefore never merges concurrent edits on an owned tree.

## 7. Group hierarchies (tree groups and segment groups)

No owners. Instead:

- **Granular update actions.** Tree groups get `upsertTreeGroup` / `deleteTreeGroup`, mirroring the segment group actions. Replacing the whole hierarchy would silently drop concurrent group changes of other users.
- **Collision-free group IDs** via ID reservation.
- **Deleting a group must not delete foreign trees.** Trees owned by others move to the parent group of the deleted group, or the deletion is refused.
- **Dangling references:** a tree whose group no longer exists is shown at the root.
- Moving a tree into a group is a change of the tree, so it follows the ownership rules from §5.

## 8. Undo/redo in live collaboration

### 8.1 Trees: restore only the touched trees

The undo saga currently restores a snapshot of the whole `SkeletonTracing`. In live collaboration, this would revert or delete trees of other users.

Instead:
- An undo entry stores the previous state of only the trees it touches (plus their IDs).
- Undo/redo swaps just these trees into the *current* tracing. The resulting diff only contains updates for those trees.

Ownership (§5) and the lockout (§6) make this safe: nobody else can have changed these trees in the meantime.

### 8.2 Groups: inverse operations with a check

Group undo applies the inverse operation, but only if the state still matches what this user left behind. Otherwise, that part of the undo is skipped. It never overrides other users' changes.

| Undo of | Inverse operation | Only if |
|---|---|---|
| Rename | Set the old name | The current name is still the one I set |
| Move | Move back to the old parent | The group is still under the parent I chose, the old parent still exists, and the move creates no cycle |
| Create | Delete the group | The group is still empty |
| Delete | Recreate it with the same ID | Its old parent still exists; otherwise recreate it at the root |

## 9. Other undo state and later extensions

- **Bounding boxes** and other annotation-wide undo state are excluded from undo in live collaboration for now. Making them undoable is milestone 4; the details are clarified later.
- **Ownership transfer** is added when we need it. The previous owner's sessions would drop their undo entries for the transferred tree.

## 10. Plan of attack

Each item is meant to be one small PR. Together they form a stack.

### Milestone 1: tree editing in live collaboration, without undo/redo

Undo/redo stays disabled in live collaboration, as it already is for brushing and proofreading. The group hierarchy stays non-editable in live collaboration; assigning trees to existing groups is allowed.

1. **Frontend ID reservation for `Tree`, `Node` and `TreeGroup`.** The backend already supports these domains. Independent of everything else.
2. **Tree owner field.** Add the owner to the `Tree` proto, set it in the backend on `createTree`, fall back to the annotation owner for old trees, and expose it in the frontend types. No enforcement yet.
3. **Backend enforcement.** In live collaboration, reject skeleton update actions that touch foreign trees, including cross-tree actions. Agglomerate trees are exempt.
4. **Rebasing coverage for skeleton update actions.** Verify (and add tests) that every non-agglomerate skeleton update action can be incorporated and reapplied during rebase.
5. **Same-user lockout (§6)** in the frontend, triggered by fetched tree-related actions authored by the current user.
6. **Enable owner-only tree editing** in the frontend: extend `mayEditSkeletonTree` and `getReasonForCantEditSkeletonTree`, allow creating trees, and disable tools and context menu entries for foreign trees.

### Milestone 2: granular tree group actions

7. **Backend:** `upsertTreeGroup` / `deleteTreeGroup` (mirroring segment groups), including the delete semantics from §7. Keep `updateTreeGroups` for old versions.
8. **Frontend:** emit the granular actions instead of `updateTreeGroups` when diffing, and apply them when incorporating fetched updates.
9. **Enable editing the tree group hierarchy** in live collaboration.

### Milestone 3: undo/redo in live collaboration

10. **Tree-scoped skeleton undo (§8.1).** Undo entries store and restore only the touched trees. Can replace the whole-tracing snapshot everywhere, which keeps one code path.
11. **Inverse-operation undo for tree groups (§8.2).**
12. **Enable skeleton undo/redo in live collaboration.** Brushing and proofreading still have no undo there. Bounding boxes and other annotation-wide state are excluded from undo (§9).
13. **Inverse-operation undo for segment groups.** Reuses the logic from 11; only needed once volume undo comes to live collaboration.

### Milestone 4: undo/redo for other state in live collaboration

Bounding boxes and other annotation-wide state (§9). Details to be clarified.
