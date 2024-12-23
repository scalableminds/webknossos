package backend

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.webknossos.datastore.SkeletonTracing._
import com.scalableminds.webknossos.datastore.MetadataEntry.MetadataEntryProto
import com.scalableminds.webknossos.tracingstore.tracings._
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating._
import org.scalatestplus.play._

class SkeletonUpdateActionsUnitTestSuite extends PlaySpec {

  private def applyUpdateAction(action: UpdateAction.SkeletonUpdateAction): SkeletonTracing =
    action.applyOn(Dummies.skeletonTracing)

  def listConsistsOfLists[T](joinedList: Seq[T], sublist1: Seq[T], sublist2: Seq[T]): Boolean =
    // assuming sublist1 & sublist2 are different
    if (joinedList.length != sublist1.length + sublist2.length)
      false
    else
      joinedList.forall(el => sublist1.contains(el) || sublist2.contains(el))

  "CreateTreeSkeletonAction" should {
    "add the specified tree" in {
      val createTreeAction = new CreateTreeSkeletonAction(
        id = 1000,
        color = None,
        name = "new tree",
        branchPoints = List(UpdateActionBranchPoint(0, Dummies.timestamp)),
        timestamp = Dummies.timestamp,
        comments = List[UpdateActionComment](),
        groupId = None,
        isVisible = Option(true),
        edgesAreVisible = Option(true)
      )
      val result = applyUpdateAction(createTreeAction)

      assert(result.trees.length == Dummies.skeletonTracing.trees.length + 1)
      val tree = result.trees.find(_.treeId == createTreeAction.id).get
      assert(tree.branchPoints == List(BranchPoint(0, Dummies.timestamp)))
      assert(tree.createdTimestamp == Dummies.timestamp)
      assert(tree.comments == createTreeAction.comments)
      assert(tree.name === createTreeAction.name)
      assert(tree.isVisible == createTreeAction.isVisible)
      assert(tree.edgesAreVisible == createTreeAction.edgesAreVisible)
    }
  }

  "DeleteTreeSkeletonAction" should {
    "delete the specified tree" in {
      val deleteTreeAction = new DeleteTreeSkeletonAction(id = 1)
      val result = applyUpdateAction(deleteTreeAction)

      assert(result.trees.length == Dummies.skeletonTracing.trees.length - 1)
      result.trees.find(_.treeId == deleteTreeAction.id) match {
        case Some(_) => throw new Exception
        case None    =>
      }
    }
  }

  "UpdateTreeSkeletonAction" should {
    "update the specified tree" in {
      val updateTreeAction = new UpdateTreeSkeletonAction(
        id = 1,
        updatedId = Some(1000),
        color = None,
        name = "updated tree",
        branchPoints = List(UpdateActionBranchPoint(0, Dummies.timestamp)),
        comments = List[UpdateActionComment](),
        groupId = None,
        metadata = Some(
          List(MetadataEntry("myKey", numberValue = Some(5.0)),
               MetadataEntry("anotherKey", stringListValue = Some(Seq("hello", "there")))))
      )
      val result = applyUpdateAction(updateTreeAction)

      assert(result.trees.length == Dummies.skeletonTracing.trees.length)
      val tree = result.trees.find(_.treeId == 1000).get
      assert(tree.branchPoints == List(BranchPoint(0, Dummies.timestamp)))
      assert(tree.createdTimestamp == Dummies.timestamp)
      assert(tree.comments == updateTreeAction.comments)
      assert(tree.name == updateTreeAction.name)
      assert(
        tree.metadata == List(MetadataEntryProto("myKey", numberValue = Some(5.0)),
                              MetadataEntryProto("anotherKey", stringListValue = Seq("hello", "there"))))
    }
  }

  "MergeTreeSkeletonAction" should {
    "merge the specified trees" in {
      val mergeTreeAction = new MergeTreeSkeletonAction(sourceId = 1, targetId = 2)
      val sourceTree = Dummies.tree1
      val targetTree = Dummies.tree2
      val result = applyUpdateAction(mergeTreeAction)

      assert(result.trees.length == Dummies.skeletonTracing.trees.length - 1)
      val tree = result.trees.find(_.treeId == 2).get
      assert(tree.name == targetTree.name)
      assert(tree.color == targetTree.color)
      assert(tree.groupId == targetTree.groupId)
      assert(listConsistsOfLists(tree.nodes, sourceTree.nodes, targetTree.nodes))
      assert(listConsistsOfLists(tree.edges, sourceTree.edges, targetTree.edges))
      // only nodes and edges are merged, everything else should not change
      assert(tree.branchPoints == targetTree.branchPoints)
      assert(tree.comments == targetTree.comments)
    }
  }

  "MoveTreeComponentSkeletonAction" should {
    "move the specified (separate) nodes" in {
      val moveTreeComponentSkeletonAction =
        new MoveTreeComponentSkeletonAction(Dummies.comp1Nodes.map(_.id).toList, sourceId = 3, targetId = 4)
      val result = moveTreeComponentSkeletonAction.applyOn(Dummies.componentSkeletonTracing)

      assert(result.trees.length == Dummies.componentSkeletonTracing.trees.length)
      val resultSourceTree = result.trees.find(_.treeId == 3).get
      val resultTargetTree = result.trees.find(_.treeId == 4).get
      assert(resultTargetTree.name == Dummies.emptyTree.name)
      assert(resultTargetTree.color == Dummies.emptyTree.color)
      assert(resultTargetTree.groupId == Dummies.emptyTree.groupId)
      assert(resultTargetTree.nodes.toSet == Dummies.comp1Nodes.toSet)
      assert(resultTargetTree.edges.toSet == Dummies.comp1Edges.toSet)
      assert(resultSourceTree.nodes.toSet == Dummies.comp2Nodes.toSet)
      assert(resultSourceTree.edges.toSet == Dummies.comp2Edges.toSet)
    }
  }

  "CreateEdgeSkeletonAction" should {
    "create a new edge in the right tree" in {
      val createEdgeSkeletonAction = new CreateEdgeSkeletonAction(source = 1, target = 7, treeId = 1)
      val result = applyUpdateAction(createEdgeSkeletonAction)

      assert(result.trees.length == Dummies.skeletonTracing.trees.length)
      val tree = result.trees.find(_.treeId == 1).get
      assert(tree.name == Dummies.tree1.name)
      assert(tree.nodes.toSet == Dummies.tree1.nodes.toSet)
      assert(listConsistsOfLists(tree.edges, Dummies.tree1.edges, List(Edge(0, 7))))
    }
  }

  "DeleteEdgeSkeletonAction" should {
    "undo CreateEdgeSkeletonAction" in {
      val createEdgeSkeletonAction = new CreateEdgeSkeletonAction(source = 0, target = 7, treeId = 1)
      val deleteEdgeSkeletonAction = new DeleteEdgeSkeletonAction(source = 0, target = 7, treeId = 1)
      val result = deleteEdgeSkeletonAction.applyOn(createEdgeSkeletonAction.applyOn(Dummies.skeletonTracing))
      assert(result == Dummies.skeletonTracing)
    }
  }

  "CreateNodeSkeletonAction" should {
    "create the specified node" in {
      val newNode = Dummies.createDummyNode(100)
      val createNodeSkeletonAction = new CreateNodeSkeletonAction(
        newNode.id,
        Vec3Int(newNode.position.x, newNode.position.y, newNode.position.z),
        Option(Vec3Double(newNode.rotation.x, newNode.rotation.y, newNode.rotation.z)),
        Option(newNode.radius),
        Option(newNode.viewport),
        Option(newNode.mag),
        Option(newNode.bitDepth),
        Option(newNode.interpolation),
        treeId = 1,
        Dummies.timestamp,
        None
      )
      val result = applyUpdateAction(createNodeSkeletonAction)
      assert(result.trees.length == Dummies.skeletonTracing.trees.length)
      val tree = result.trees.find(_.treeId == 1).get
      assert(tree.name == Dummies.tree1.name)
      assert(tree.nodes.length == Dummies.tree1.nodes.length + 1)
      assert(tree.nodes.contains(newNode))
    }
  }

  "UpdateNodeSkeletonAction" should {
    "update the specified node" in {
      val newNode = Dummies.createDummyNode(1)
      val updateNodeSkeletonAction = new UpdateNodeSkeletonAction(
        newNode.id,
        Vec3Int(newNode.position.x, newNode.position.y, newNode.position.z),
        Option(Vec3Double(newNode.rotation.x, newNode.rotation.y, newNode.rotation.z)),
        Option(newNode.radius),
        Option(newNode.viewport),
        Option(newNode.mag),
        Option(newNode.bitDepth),
        Option(newNode.interpolation),
        treeId = 1,
        Dummies.timestamp,
        None
      )
      val result = applyUpdateAction(updateNodeSkeletonAction)
      assert(result.trees.length == Dummies.skeletonTracing.trees.length)
      val tree = result.trees.find(_.treeId == 1).get
      assert(tree.name == Dummies.tree1.name)
      assert(tree.nodes.length == Dummies.tree1.nodes.length)
      assert(tree.nodes.contains(newNode))
    }
  }

  "DeleteNodeSkeletonAction" should {
    "undo CreateNodeSkeletonAction" in {
      val newNode = Dummies.createDummyNode(100)
      val createNodeSkeletonAction = new CreateNodeSkeletonAction(
        newNode.id,
        Vec3Int(newNode.position.x, newNode.position.y, newNode.position.z),
        Option(Vec3Double(newNode.rotation.x, newNode.rotation.y, newNode.rotation.z)),
        Option(newNode.radius),
        Option(newNode.viewport),
        Option(newNode.mag),
        Option(newNode.bitDepth),
        Option(newNode.interpolation),
        treeId = 1,
        Dummies.timestamp,
        None
      )
      val deleteNodeSkeletonAction = new DeleteNodeSkeletonAction(newNode.id, treeId = 1)
      val result = deleteNodeSkeletonAction.applyOn(createNodeSkeletonAction.applyOn(Dummies.skeletonTracing))
      assert(result == Dummies.skeletonTracing)
    }
  }

  "UpdateTreeGroupsSkeletonAction" should {
    "update a top level tree group" in {
      val updatedName = "Axon 2 updated"
      val updateTreeGroupsSkeletonAction = new UpdateTreeGroupsSkeletonAction(
        List(UpdateActionTreeGroup(updatedName, 2, Some(true), List()))
      )
      val result = applyUpdateAction(updateTreeGroupsSkeletonAction)
      assert(result.trees == Dummies.skeletonTracing.trees)
      val treeGroup = result.treeGroups.find(_.groupId == 2).get
      assert(treeGroup.name == updatedName)
    }
    "update a nested tree group" in {
      val updatedNameTop = "Axon 1 updated"
      val updatedNameNested = "Axon 3 updated"
      val updateTreeGroupsSkeletonAction = new UpdateTreeGroupsSkeletonAction(
        List(
          UpdateActionTreeGroup(updatedNameTop,
                                1,
                                Some(true),
                                List(UpdateActionTreeGroup(updatedNameNested, 3, Some(false), List()))))
      )
      val result = applyUpdateAction(updateTreeGroupsSkeletonAction)
      assert(result.trees == Dummies.skeletonTracing.trees)
      val treeGroupTop = result.treeGroups.find(_.groupId == 1).get
      assert(treeGroupTop.name == updatedNameTop)
      val treeGroupNested = treeGroupTop.children.find(_.groupId == 3).get
      assert(treeGroupNested.name == updatedNameNested)
    }
  }

  "UpdateTracingSkeletonAction" should {
    "update a top level tree group" in {
      val activeNode = Some(1)
      val editPosition = Vec3Int(11, 12, 13)
      val editRotation = Vec3Double(21, 22, 23)
      val zoomLevel = 99
      val userBoundingBox = None
      val updateTreeGroupsSkeletonAction = new UpdateTracingSkeletonAction(
        activeNode,
        editPosition,
        editRotation,
        zoomLevel,
        userBoundingBox
      )
      val result = applyUpdateAction(updateTreeGroupsSkeletonAction)
      assert(result.trees == Dummies.skeletonTracing.trees)
      assert(result.activeNodeId == activeNode)
      assert(result.editPosition.x == editPosition.x)
      assert(result.editPosition.y == editPosition.y)
      assert(result.editPosition.z == editPosition.z)
      assert(result.editRotation.x == editRotation.x)
      assert(result.editRotation.y == editRotation.y)
      assert(result.editRotation.z == editRotation.z)
      assert(result.zoomLevel == zoomLevel)
      assert(result.userBoundingBox == userBoundingBox)
    }
  }
}
