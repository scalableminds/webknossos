# Local mesh refreshing after a proofreading action

Call hierarchy from a proofreading interaction down to the mesh refreshing.
★ marks the mechanisms this feature introduces.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant H as Proofreading handler
  participant T as updateProofreadingSegmentsAndScheduleSyncMeshes
  participant I as updateAffectedSegmentItems
  participant CM as common_mesh_saga
  participant R as scheduleMeshUpdate
  participant S as syncAffectedAndLoadMissingMeshes
  participant L as local_mesh_change_sagas
  participant C as SegmentMeshController
  participant B as Backend

  U->>H: merge / split / min-cut interaction
  Note over H: all 6 handlers build a plain refreshInfos:<br/>AgglomerateChangeItem[] themselves<br/>performPartitionedMinCut derives it from every<br/>removed edge's endpoints, so a cut producing more<br/>than two agglomerates names all of them
  H->>T: call(volumeTracingId, refreshInfos, ctx, annotationVersion ★)

  rect rgba(128,128,128,0.12)
    Note over T,CM: segment items: immediate
    T->>I: updateAffectedSegmentItems(layerName, items)
    I->>CM: removeSegmentAction(oldId, preserveMesh = true) ★
    CM-->>I: returns early, the mesh stays in the scene
    I->>I: clickSegmentAction for every newAgglomerateId
    T->>B: syncWithBackend (flush save queue, release mutex)
  end

  T->>R: scheduleMeshUpdate(syncAffectedAndMaybeLoadMissingMeshes, items)
  R->>R: cancel in-flight tasks sharing an agglomerate id
  R-)S: spawn runEffectWithOrphanCleanup (detached)
  T-->>H: returns without waiting for the mesh work

  rect rgba(128,128,128,0.12)
    Note over S,B: meshes: detached, cancellable
    S->>S: shouldReloadMeshesAfterProofreadAction? (else stop, no request at all)
    S->>S: getMeshDisplayPropsByOldAgglomerateId (opacity / visibility)
    S->>S: detectMergeAndSplitChanges -> mergeGroups, splitGroups, remainingItems

    loop per merge group
      S->>L: tryLocalMeshMerge(oldIds, newId, annotationVersion)
      L->>L: waitForMeshFullyLoaded per old id ★
      Note over L: races REMOVE_MESH and a 30s timeout,<br/>so a mesh that never settles cannot stall the batch
      alt no mesh loaded, an involved mesh is ad-hoc, or the wait failed
        L-->>S: false, items go to itemsToReload
      else every involved mesh is precomputed
        opt only one side has a mesh
          L->>B: chunk list of newId, then fetch the delta chunks
          L->>C: append them to oldId's group
          Note over L,B: a failed fetch also falls back to a reload ★
        end
        L->>C: moveMeshesToNewSegmentId + mergeMeshSiblingsIntoOneGeometry
        L-->>S: true, MERGE_MESHES, no reload
      end
    end

    loop per split group
      S->>L: trySplitMeshLocally(oldId, newIds, annotationVersion)
      L->>L: waitForMeshFullyLoaded(oldId) ★
      L->>C: mesh loaded, precomputed and fully merged?
      Note over L,C: if not, give up here - no request is made
      L->>B: ★ segmentsForAgglomerate per new id, at annotationVersion (pooled)
      Note over L,B: only segment ids, so it stays cheap for large agglomerates.<br/>agglomerateIdIsPresent separates a missing graph from a failed request
      L->>C: ★ collectMissingGeometry - gaps per new id and per LOD
      opt a new id misses a few of its segments
        L->>B: ★ chunk list per missing segment, without any mapping (pooled)
        L->>C: ★ append the fetched chunks to oldId's group
      end
      L->>C: ★ getNewAgglomerateIdsWithoutGeometry
      alt at least one new id has complete geometry
        L->>C: splitMeshByNewMapping for those ids
        Note over L,C: guarded - a geometry failure returns false<br/>instead of escalating into an app crash ★
        L-->>S: ★ handledLocally + idsNeedingReload (SPLIT_MESH)
      else
        L-->>S: not handled, all items go to itemsToReload
      end
    end

    opt itemsToReload is not empty
      Note over S: remainingItems, failed groups and idsNeedingReload
      S->>C: removeMeshAction for old ids that no splice kept alive
      S->>B: load meshes for the remaining new ids
    end
  end

  S-->>R: settled or cancelled
  R->>C: cleanUpOrphanedMeshes ★ remove meshes whose segment item is gone
```

## What the diagram shows

1. **One shared tail.** All six handlers (`handleProofreadMerge`, `handleMinCutAgglomerate`,
   `performPartitionedMinCut`, `handleProofreadCutFromNeighbors`, `handleMergeViaTree`,
   `handleSplitViaTree`) go through `updateProofreadingSegmentsAndScheduleSyncMeshes` with a
   pre-built array, instead of four of them duplicating the tail inline.

2. **`preserveMesh`.** The segment item still disappears immediately (the save queue depends on
   it), but the mesh survives into the detached phase, which is what makes a local splice possible
   at all - previously `handleRemoveSegment` had already disposed the geometry before
   `tryLocalMeshMerge` ran.

3. **A pinned `annotationVersion`.** The mesh work runs detached, so by the time it asks the
   back-end anything, an unrelated action may already have raised the annotation version. Each
   handler therefore passes the version its operation was saved at - the same one handed to
   `splitAgglomerateInMapping` - so the segment lists match the mapping that was just built.

4. **Authoritative segment lists instead of scene inspection.** A split asks
   `segmentsForAgglomerate` which segments each new agglomerate consists of, rather than reading
   the loaded mesh's supervoxels and classifying them against the partial local mapping. Chunk
   descriptors would carry the same information, but also every chunk's position and byte range,
   which is slow exactly for the large agglomerates this feature exists to speed up.

5. **Completing the mesh before splitting.** Segments that belong to the mesh but have no geometry
   in the scene are fetched first, one cheap chunk listing per missing segment, requested without a
   mapping so the back-end does not expand the id into a whole agglomerate. The gaps are tracked
   per LOD, because a segment can have geometry for one LOD but not for another. A new id missing
   all or more than `MAX_SEGMENTS_TO_COMPLETE_PER_AGGLOMERATE` of its segments is left out -
   reloading its mesh as a whole is cheaper.

6. **Partial local splits.** A new id that ends up without complete geometry no longer cancels the
   whole split. It is reported back as `idsNeedingReload`, the other fragments keep their spliced
   mesh, and only the reported ones are loaded again.

7. **Every local path can decline.** Waiting for a mesh is bounded, an ad-hoc mesh is never spliced
   (it covers only the agglomerate it was computed for), a failed chunk fetch is reported rather
   than silently accepted, and the scene-graph surgery is guarded. Each of these returns "not
   handled locally", which routes the items into the ordinary reload path - the behaviour before
   this feature existed.

8. **Pooled requests.** The segment-list requests of a split, and the chunk listings of its missing
   segments, run through `processTaskWithPool` rather than one after another, so an N-way split
   does not serialize N round trips.

9. **`cleanUpOrphanedMeshes` in a `finally`.** Now that disposal happens inside the cancellable
   task, a task cancelled by a newer overlapping one could otherwise leave a mesh alive with no
   segment item and no owner.

The two `rect` blocks mark the synchronous/detached boundary - the tail returns before any mesh
work happens, which is what makes several test expectations in this PR non-obvious.
