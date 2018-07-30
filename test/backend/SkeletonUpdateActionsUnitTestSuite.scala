package backend

import com.scalableminds.webknossos.datastore.SkeletonTracing._
import com.scalableminds.webknossos.datastore.geometry.{Point3D, Vector3D}
import com.scalableminds.webknossos.datastore.tracings._
import com.scalableminds.webknossos.datastore.tracings.skeleton.updating._
import org.scalatest.FlatSpec


class SkeletonUpdateActionsUnitTestSuite extends FlatSpec {

  def applyUpdateAction(action: UpdateAction.SkeletonUpdateAction) =
    action.applyOn(Dummies.tracing)


  "CreateTreeSkeletonAction" should "add the specified tree" in {
    val createTreeAction = new CreateTreeSkeletonAction(
      id = 1000,
      color = None,
      name = "new tree",
      branchPoints = List(UpdateActionBranchPoint(0, backend.Dummies.timestamp)),
      timestamp = backend.Dummies.timestamp,
      comments = List[UpdateActionComment]()
    )
    val result = applyUpdateAction(createTreeAction)

    assert(result.trees.length == backend.Dummies.tracing.trees.length + 1)
    result.trees.find(_.treeId == createTreeAction.id) match {
      case Some(tree) => {
        assert(tree.branchPoints == List(BranchPoint(0, backend.Dummies.timestamp)))
        assert(tree.createdTimestamp == backend.Dummies.timestamp)
        assert(tree.comments == createTreeAction.comments)
        assert(tree.name === createTreeAction.name)
      }
      case _ => throw new Exception
    }
  }

  "DeleteTreeSkeletonAction" should "delete the specified tree" in {
    val deleteTreeAction = new DeleteTreeSkeletonAction(id = 1)
    val result = applyUpdateAction(deleteTreeAction)

    assert(result.trees.length == backend.Dummies.tracing.trees.length - 1)
    result.trees.find(_.treeId == deleteTreeAction.id) match {
      case Some(tree) => throw new Exception
      case None =>
    }
  }

  "UpdateTreeSkeletonAction" should "update the specified tree" in {
    val updateTreeAction = new UpdateTreeSkeletonAction(
      id = 1,
      updatedId = Some(1000),
      color = None,
      name = "updated tree",
      branchPoints = List(UpdateActionBranchPoint(0, backend.Dummies.timestamp)),
      comments = List[UpdateActionComment](),
      groupId = None
    )
    val result = applyUpdateAction(updateTreeAction)

    assert(result.trees.length == backend.Dummies.tracing.trees.length)
    result.trees.find(_.treeId == 1000) match {
      case Some(tree) => {
        assert(tree.branchPoints == List(BranchPoint(0, backend.Dummies.timestamp)))
        assert(tree.createdTimestamp == backend.Dummies.timestamp)
        assert(tree.comments == updateTreeAction.comments)
        assert(tree.name === updateTreeAction.name)
      }
      case _ => throw new Exception
    }
  }
}
