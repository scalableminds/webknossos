package backend

import com.scalableminds.webknossos.datastore.SkeletonTracing._
import com.scalableminds.webknossos.datastore.geometry.{Point3D, Vector3D}
import com.scalableminds.webknossos.datastore.tracings._
import com.scalableminds.webknossos.datastore.tracings.skeleton.updating._
import org.scalatest.FlatSpec


class SkeletonUpdateActionsUnitTestSuite extends FlatSpec {
  val timestamp = 123456789

  object Dummy {
    def createDummyNode(id: Int) = Node(id, Point3D(id, id, id), Vector3D(id, id, id), id, 1, 10, 8, id % 2 == 0, timestamp)

    val tree1 = Tree(1, Seq(createDummyNode(0), createDummyNode(1), createDummyNode(2), createDummyNode(7)),
      Seq(Edge(0, 1), Edge(2, 1), Edge(1, 7)), Some(Color(23, 23, 23, 1)), Seq(BranchPoint(1, 0), BranchPoint(7, 0)), Seq(Comment(0, "comment")),
      "TestTree-0", timestamp, None)

    val tree2 = Tree(2, Seq(createDummyNode(4), createDummyNode(5), createDummyNode(6)),
      Seq(Edge(4, 5), Edge(5, 6)), Some(Color(30, 30, 30, 1)), Seq[BranchPoint](), Seq[Comment](),
      "TestTree-1", timestamp, Some(1))

    val treeGroup1 = TreeGroup("Axon 1", 1, Seq(TreeGroup("Blah", 3), TreeGroup("Blah 2", 4)))
    val treeGroup2 = TreeGroup("Axon 2", 2)

    val tracing = SkeletonTracing("dummy_dataset", Seq(tree1, tree2), timestamp, None, Some(1), Point3D(1, 1, 1), Vector3D(1.0, 1.0, 1.0), 1.0, 0, None, Seq(treeGroup1, treeGroup2))

    def applyUpdateAction(action: UpdateAction.SkeletonUpdateAction) =
      action.applyOn(tracing)
  }




  "CreateTreeSkeletonAction" should "add a new tree with the correct id" in {
    val createTreeAction = new CreateTreeSkeletonAction(
      id = 1000,
      color = None,
      name = "some stuff",
      branchPoints = List(UpdateActionBranchPoint(0, timestamp)),
      timestamp = timestamp,
      comments = List[UpdateActionComment]()
    )
    val result = Dummy.applyUpdateAction(createTreeAction)

    assert(result.trees.length == Dummy.tracing.trees.length + 1)
    result.trees.find(_.treeId == createTreeAction.id) match {
      case Some(tree) => {
        assert(tree.branchPoints == List(BranchPoint(0, timestamp)))
        assert(tree.createdTimestamp == timestamp)
        assert(tree.comments == createTreeAction.comments)
      }
      case _ => throw new Exception
    }
  }
}
