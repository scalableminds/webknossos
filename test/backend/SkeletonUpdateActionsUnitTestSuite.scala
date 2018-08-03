package backend

import com.scalableminds.webknossos.datastore.SkeletonTracing._
import com.scalableminds.webknossos.datastore.tracings._
import com.scalableminds.webknossos.datastore.tracings.skeleton.updating._
import org.scalatest.FlatSpec


class SkeletonUpdateActionsUnitTestSuite extends FlatSpec {

  def applyUpdateAction(action: UpdateAction.SkeletonUpdateAction) =
    action.applyOn(Dummies.tracing)

  def listConsistsOfLists[T](joinedList: Seq[T], sublist1: Seq[T], sublist2: Seq[T]): Boolean = {
    // assuming sublist1 & sublist2 are different
    if (joinedList.length != sublist1.length + sublist2.length)
      return false
    return joinedList.forall(el => sublist1.contains(el) || sublist2.contains(el))
  }


  "CreateTreeSkeletonAction" should "add the specified tree" in {
    val createTreeAction = new CreateTreeSkeletonAction(
      id = 1000,
      color = None,
      name = "new tree",
      branchPoints = List(UpdateActionBranchPoint(0, Dummies.timestamp)),
      timestamp = Dummies.timestamp,
      comments = List[UpdateActionComment]()
    )
    val result = applyUpdateAction(createTreeAction)

    assert(result.trees.length == Dummies.tracing.trees.length + 1)
    val tree = result.trees.find(_.treeId == createTreeAction.id).get
    assert(tree.branchPoints == List(BranchPoint(0, Dummies.timestamp)))
    assert(tree.createdTimestamp == Dummies.timestamp)
    assert(tree.comments == createTreeAction.comments)
    assert(tree.name === createTreeAction.name)
  }

  "DeleteTreeSkeletonAction" should "delete the specified tree" in {
    val deleteTreeAction = new DeleteTreeSkeletonAction(id = 1)
    val result = applyUpdateAction(deleteTreeAction)

    assert(result.trees.length == Dummies.tracing.trees.length - 1)
    result.trees.find(_.treeId == deleteTreeAction.id) match {
      case Some(_) => throw new Exception
      case None =>
    }
  }

  "UpdateTreeSkeletonAction" should "update the specified tree" in {
    val updateTreeAction = new UpdateTreeSkeletonAction(
      id = 1,
      updatedId = Some(1000),
      color = None,
      name = "updated tree",
      branchPoints = List(UpdateActionBranchPoint(0, Dummies.timestamp)),
      comments = List[UpdateActionComment](),
      groupId = None
    )
    val result = applyUpdateAction(updateTreeAction)

    assert(result.trees.length == Dummies.tracing.trees.length)
    val tree = result.trees.find(_.treeId == 1000).get
    assert(tree.branchPoints == List(BranchPoint(0, Dummies.timestamp)))
    assert(tree.createdTimestamp == Dummies.timestamp)
    assert(tree.comments == updateTreeAction.comments)
    assert(tree.name == updateTreeAction.name)
  }

  "MergeTreeSkeletonAction" should "merge the specified trees" in {
    val mergeTreeAction = new MergeTreeSkeletonAction(sourceId = 1, targetId = 2)
    val sourceTree = Dummies.tree1
    val targetTree = Dummies.tree2
    val result = applyUpdateAction(mergeTreeAction)

    assert(result.trees.length == Dummies.tracing.trees.length-1)
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

  "MoveTreeComponentSkeletonAction" should "move the specified (seperate) nodes" in {
    val moveTreeComponentSkeletonAction = new MoveTreeComponentSkeletonAction(Dummies.comp1Nodes.map(_.id).toList, sourceId = 3, targetId = 4)
    val result = moveTreeComponentSkeletonAction.applyOn(Dummies.componentTracing)

    assert(result.trees.length == Dummies.componentTracing.trees.length)
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

  "CreateEdgeSkeletonAction" should "create a new edge in the right tree" in {
    val createEdgeSkeleton = new CreateEdgeSkeletonAction(source = 1, target = 7, treeId = 1)
    val result = applyUpdateAction(createEdgeSkeleton)

    assert(result.trees.length == Dummies.tracing.trees.length)
    val tree = result.trees.find(_.treeId == 1).get
    assert(tree.name == Dummies.tree1.name)
    assert(tree.nodes.toSet == Dummies.tree1.nodes.toSet)
    assert(listConsistsOfLists(tree.edges, Dummies.tree1.edges, List(Edge(0, 7))))
  }

  "DeleteEdgeSkeletonAction" should "undo CreateEdgeSkeletonAction" in {
    val createEdgeSkeleton = new CreateEdgeSkeletonAction(source = 0, target = 7, treeId = 1)
    val deleteEdgeSkeleton = new DeleteEdgeSkeletonAction(source = 0, target = 7, treeId = 1)
    val result = deleteEdgeSkeleton.applyOn(createEdgeSkeleton.applyOn(Dummies.tracing))
    assert(result == Dummies.tracing)
  }
}
