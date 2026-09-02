package backend

import com.scalableminds.webknossos.datastore.SkeletonTracing.{Edge, TreeGroup}
import com.scalableminds.webknossos.datastore.geometry.{BoundingBoxProto, NamedBoundingBoxProto, Vec3IntProto}
import com.scalableminds.webknossos.tracingstore.tracings.{BoundingBoxMerger, GroupUtils}
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.TreeUtils
import org.scalatest.wordspec.AnyWordSpec

// Covers the merge convention shared by TreeUtils, GroupUtils and BoundingBoxMerger: tracing A's ids
// are never remapped, tracing B's ids are densified/deduplicated and offset to continue right after A's.
class MergeUtilsTestSuite extends AnyWordSpec with BoundingBoxMerger {

  private def bbox(id: Int, topLeft: Int = 0) =
    NamedBoundingBoxProto(id, boundingBox = BoundingBoxProto(Vec3IntProto(topLeft, 0, 0), 1, 1, 1))

  "TreeUtils.calculateNodeMapping" should {
    "offset tracing B's node ids to continue right after tracing A's, leaving A untouched" in {
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
  }

  "TreeUtils.calculateTreeMapping" should {
    "densify tracing B's tree ids and offset them to continue right after tracing A's max tree id" in {
      val treesA = Seq(Dummies.tree1.copy(treeId = 1), Dummies.tree2.copy(treeId = 9))
      val treesB = Seq(Dummies.tree1.copy(treeId = 5), Dummies.tree2.copy(treeId = 3))

      val treeIdMapB = TreeUtils.calculateTreeMapping(treesA, treesB)

      assert(treeIdMapB == Map(3 -> 10, 5 -> 11))
    }
  }

  "TreeUtils.mergeTrees" should {
    "leave tracing A's trees byte-identical and append the remapped tracing B trees" in {
      val treesA = Seq(Dummies.tree1) // treeId 1, nodes 0, 1, 2, 7
      val treesB = Seq(Dummies.tree2.copy(treeId = 9, groupId = Some(1))) // nodes 4, 5, 6

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
    "offset tracing B's group ids to continue right after tracing A's, leaving A untouched" in {
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
    "leave tracing A's boxes and ids untouched and append tracing B's non-duplicate boxes with new ids" in {
      val boxesA = Seq(bbox(1), bbox(3))
      val boxesB = Seq(bbox(1, topLeft = 1)) // distinct content from any of A's boxes, but has a colliding id

      val (merged, idMapB) = combineUserBoundingBoxes(None, None, boxesA, boxesB)

      assert(merged.take(2) == boxesA)
      assert(merged(2).id == 4)
      assert(idMapB == Map(1 -> 4))
    }

    "drop tracing B's boxes that duplicate one of tracing A's by content, without touching A" in {
      val boxesA = Seq(bbox(1))
      val boxesB = Seq(bbox(7)) // same content (topLeft = 0) as A's box, just a different id

      val (merged, idMapB) = combineUserBoundingBoxes(None, None, boxesA, boxesB)

      assert(merged == boxesA)
      assert(idMapB.isEmpty)
    }
  }
}
