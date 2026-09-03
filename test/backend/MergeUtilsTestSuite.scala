package backend

import com.scalableminds.webknossos.datastore.SkeletonTracing.{Edge, TreeGroup}
import com.scalableminds.webknossos.datastore.geometry.{BoundingBoxProto, NamedBoundingBoxProto, Vec3IntProto}
import com.scalableminds.webknossos.tracingstore.tracings.{BoundingBoxMerger, GroupUtils}
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.TreeUtils
import org.scalatest.wordspec.AnyWordSpec

// Covers the merge convention of TreeUtils and GroupUtils: tracing A’s ids are never remapped, tracing
// B’s ids are offset to continue right after A’s. BoundingBoxMerger is the deliberate
// exception: bounding boxes support content-based deduplication, so both tracings’ ids may be remapped.
class MergeUtilsTestSuite extends AnyWordSpec with BoundingBoxMerger {

  private def bbox(id: Int, topLeft: Int = 0) =
    NamedBoundingBoxProto(id, boundingBox = BoundingBoxProto(Vec3IntProto(topLeft, 0, 0), 1, 1, 1))

  "TreeUtils.calculateNodeMapping" should {
    "offset tracing B’s node ids to continue right after tracing A’s, leaving A untouched" in {
      val treesA = Seq(Dummies.tree1) // node ids 0, 1, 2, 7 => max 7
      val treesB = Seq(Dummies.tree2) // node ids 4, 5, 6 => min 4
      val mapping = TreeUtils.calculateNodeMapping(treesA, treesB)

      assert(mapping(4) == 8)
      assert(mapping(5) == 9)
      assert(mapping(6) == 10)
    }

    "not offset anything if tracing B has no trees" in {
      val mapping = TreeUtils.calculateNodeMapping(Seq(Dummies.tree1), Seq.empty)
      assert(mapping(4) == 4)
    }

    "only shift tracing B’s node ids, not densify them: gaps within B’s own ids survive" in {
      val treesA =
        Seq(Dummies.tree1.copy(nodes = Seq(Dummies.createDummyNode(0), Dummies.createDummyNode(10)))) // max 10
      val treesB = Seq(
        Dummies.tree2
          .copy(nodes = Seq(Dummies.createDummyNode(4), Dummies.createDummyNode(5), Dummies.createDummyNode(9)))
      ) // ids 4, 5, 9: a gap of 3 (6, 7, 8 missing) between 5 and 9; min 4

      val mapping = TreeUtils.calculateNodeMapping(treesA, treesB)

      // offset = maxA(10) + 1 - minB(4) = 7: every id is shifted by the same amount, so the internal
      // gap is preserved (12 -> 16, a gap of 4), unlike tree ids below, which get fully compacted.
      assert(mapping(4) == 11)
      assert(mapping(5) == 12)
      assert(mapping(9) == 16)
    }
  }

  "TreeUtils.calculateTreeMapping" should {
    "densify tracing B’s tree ids and offset them to continue right after tracing A’s max tree id" in {
      val treesA = Seq(Dummies.tree1.copy(treeId = 1), Dummies.tree2.copy(treeId = 9))
      val treesB = Seq(Dummies.tree1.copy(treeId = 5), Dummies.tree2.copy(treeId = 3))

      val treeIdMapB = TreeUtils.calculateTreeMapping(treesA, treesB)

      assert(treeIdMapB == Map(3 -> 10, 5 -> 11))
    }

    "close gaps within tracing B’s own tree ids, unlike node ids, which are only shifted" in {
      val treesA = Seq(Dummies.tree1.copy(treeId = 1)) // max tree id 1
      val treesB = Seq(Dummies.tree1.copy(treeId = 3), Dummies.tree2.copy(treeId = 100)) // a huge gap between 3 and 100

      val treeIdMapB = TreeUtils.calculateTreeMapping(treesA, treesB)

      // B’s sorted tree ids [3, 100] are renumbered consecutively as 2, 3 (offset 1 + index + 1) -- the
      // gap of 97 is closed, not preserved as a shift (which would have produced 4 -> 101).
      assert(treeIdMapB == Map(3 -> 2, 100 -> 3))
    }
  }

  "TreeUtils.mergeTrees" should {
    "leave tracing A’s trees untouched and append the remapped tracing B trees" in {
      val treesA = Seq(Dummies.tree1)
      val treesB = Seq(Dummies.tree2.copy(treeId = 9, groupId = Some(1)))

      val treeIdMapB = TreeUtils.calculateTreeMapping(treesA, treesB)
      val nodeMappingB = TreeUtils.calculateNodeMapping(treesA, treesB)
      val groupMappingB = (groupId: Int) => groupId + 100

      val merged = TreeUtils.mergeTrees(treesA, treesB, treeIdMapB, nodeMappingB, groupMappingB)

      assert(merged.head == Dummies.tree1)
      val mergedTreeB = merged(1)
      assert(mergedTreeB.treeId == treeIdMapB(9))
      assert(mergedTreeB.nodes.map(_.id).toSet == Set(8, 9, 10))
      assert(mergedTreeB.edges.toSet == Set(Edge(8, 9), Edge(9, 10)))
      assert(mergedTreeB.groupId.contains(101))
    }
  }

  "GroupUtils.calculateTreeGroupMapping / mergeTreeGroups" should {
    "offset tracing B’s group ids to continue right after tracing A’s, leaving A untouched" in {
      val groupsA = Seq(TreeGroup("G1", 1, Seq.empty), TreeGroup("G2", 5, Seq.empty))
      val groupsB = Seq(TreeGroup("G3", 2, Seq.empty))

      val groupMappingB = GroupUtils.calculateTreeGroupMapping(groupsA, groupsB)
      assert(groupMappingB(2) == 6)

      val merged = GroupUtils.mergeTreeGroups(groupsA, groupsB, groupMappingB)
      assert(merged.map(_.groupId) == Seq(1, 5, 6))
      assert(merged.take(2) == groupsA)
    }
  }

  "BoundingBoxMerger.combineUserBoundingBoxes" should {
    "pool and renumber both tracings’ boxes from scratch, in A-then-B order" in {
      val boxesA = Seq(bbox(1), bbox(3, topLeft = 1))
      val boxesB = Seq(bbox(1, topLeft = 2)) // distinct content from A’s boxes, but a colliding id

      val (merged, idMapA, idMapB) = combineUserBoundingBoxes(None, None, boxesA, boxesB)

      assert(merged.map(_.boundingBox) == (boxesA ++ boxesB).map(_.boundingBox))
      assert(merged.map(_.id) == Seq(0, 1, 2))
      assert(idMapA == Map(1 -> 0, 3 -> 1))
      assert(idMapB == Map(1 -> 2))
    }

    "deduplicate a box that exists identically in both tracings, keeping tracing A’s copy" in {
      val boxesA = Seq(bbox(1))
      val boxesB = Seq(bbox(7)) // same content (topLeft = 0) as A’s box, just a different id

      val (merged, idMapA, idMapB) = combineUserBoundingBoxes(None, None, boxesA, boxesB)

      assert(merged == Seq(bbox(0)))
      assert(idMapA == Map(1 -> 0))
      assert(idMapB.isEmpty) // B’s duplicate was dropped entirely, not remapped onto anything
    }

    "deduplicate two boxes with the same content within tracing A itself" in {
      val boxesA = Seq(bbox(1), bbox(2)) // both topLeft = 0, i.e. identical content

      val (merged, idMapA, _) = combineUserBoundingBoxes(None, None, boxesA, Seq.empty)

      assert(merged == Seq(bbox(0)))
      assert(idMapA == Map(1 -> 0)) // id 2 was dropped as a duplicate and is absent from the map
    }

    "fold tracing A’s deprecated legacy single bounding box into the same pool" in {
      val boxesA = Seq(bbox(3))
      val singleA = BoundingBoxProto(Vec3IntProto(5, 0, 0), 1, 1, 1) // distinct content from boxesA

      val (merged, idMapA, _) = combineUserBoundingBoxes(Some(singleA), None, boxesA, Seq.empty)

      assert(merged.map(_.boundingBox) == Seq(boxesA.head.boundingBox, singleA))
      assert(idMapA == Map(3 -> 0))
    }
  }
}
