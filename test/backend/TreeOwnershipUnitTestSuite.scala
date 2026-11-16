package backend

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.webknossos.datastore.SkeletonTracing.{Tree, TreeTypeProto}
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.TreeOwnership
import com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating.*
import org.scalatest.wordspec.AsyncWordSpec

class TreeOwnershipUnitTestSuite extends AsyncWordSpec {

  private val annotationOwner = ObjectId.generate
  private val user = ObjectId.generate
  private val otherUser = ObjectId.generate
  private val tracingId = Dummies.tracingId

  private def tree(id: Int, ownerId: Option[ObjectId], isAgglomerate: Boolean = false): Tree =
    Tree(
      id,
      Seq(),
      Seq(),
      None,
      Seq(),
      Seq(),
      s"tree $id",
      Dummies.timestamp,
      None,
      `type` = if (isAgglomerate) Some(TreeTypeProto.AGGLOMERATE) else None,
      ownerId = ownerId.map(_.toString)
    )

  private val ownTree = tree(1, Some(user))
  private val foreignTree = tree(2, Some(otherUser))
  private val unownedTree = tree(3, None)
  private val foreignAgglomerateTree = tree(4, Some(otherUser), isAgglomerate = true)
  private val trees = Seq(ownTree, foreignTree, unownedTree, foreignAgglomerateTree)

  private def deleteNode(treeId: Int) =
    DeleteNodeSkeletonAction(nodeId = 1, treeId = treeId, actionTracingId = tracingId)

  private def foreignTreeIds(actions: Seq[SkeletonUpdateAction], requestingUser: ObjectId = user): Seq[Int] =
    TreeOwnership.findForeignTreeIds(trees, annotationOwner, requestingUser, actions)

  "TreeOwnership.findForeignTreeIds" should {
    "allow editing own trees" in
      assert(foreignTreeIds(Seq(deleteNode(1), DeleteTreeSkeletonAction(1, tracingId))).isEmpty)

    "reject editing trees of other users" in {
      assert(foreignTreeIds(Seq(deleteNode(1), deleteNode(2))) == Seq(2))
      assert(foreignTreeIds(Seq(DeleteTreeSkeletonAction(2, tracingId))) == Seq(2))
      assert(foreignTreeIds(Seq(CreateEdgeSkeletonAction(1, 2, 2, tracingId))) == Seq(2))
    }

    "treat trees without owner as owned by the annotation owner" in {
      assert(foreignTreeIds(Seq(deleteNode(3))) == Seq(3))
      assert(foreignTreeIds(Seq(deleteNode(3)), requestingUser = annotationOwner).isEmpty)
    }

    "allow editing agglomerate trees of other users" in
      assert(foreignTreeIds(Seq(deleteNode(4), DeleteTreeSkeletonAction(4, tracingId))).isEmpty)

    "allow tree ids that are not in the stored tracing" in
      assert(foreignTreeIds(Seq(deleteNode(1000), DeleteEdgeSkeletonAction(1, 2, 1000, tracingId))).isEmpty)

    "reject merging or moving components if one of the trees is foreign" in {
      assert(foreignTreeIds(Seq(MergeTreeSkeletonAction(1, 2, tracingId))) == Seq(2))
      assert(foreignTreeIds(Seq(MergeTreeSkeletonAction(2, 1, tracingId))) == Seq(2))
      assert(foreignTreeIds(Seq(MoveTreeComponentSkeletonAction(List(1), 1, 2, tracingId))) == Seq(2))
      assert(foreignTreeIds(Seq(MergeTreeSkeletonAction(1000, 1, tracingId))).isEmpty)
    }

    "exempt user state actions and tree creation" in {
      val actions: Seq[SkeletonUpdateAction] = Seq(
        UpdateTreeVisibilitySkeletonAction(2, isVisible = false, tracingId),
        UpdateActiveNodeSkeletonAction(Some(1), tracingId),
        CreateTreeSkeletonAction(
          id = 2,
          color = None,
          name = "new tree",
          branchPoints = List(),
          timestamp = Dummies.timestamp,
          comments = List(),
          groupId = None,
          isVisible = None,
          edgesAreVisible = None,
          agglomerateInfo = None,
          actionTracingId = tracingId
        )
      )
      assert(foreignTreeIds(actions).isEmpty)
    }
  }
}
