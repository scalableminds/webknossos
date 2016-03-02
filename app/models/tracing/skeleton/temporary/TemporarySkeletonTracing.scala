package models.tracing.skeleton.temporary

import com.scalableminds.util.geometry.{Vector3D, BoundingBox, Point3D}
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.Fox
import models.annotation._
import models.tracing.skeleton.{DBTreeService, SkeletonTracingService, SkeletonTracing, SkeletonTracingLike}
import oxalis.nml.utils._
import oxalis.nml.{BranchPoint, Comment, NML, TreeLike}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.JsValue
import reactivemongo.bson.BSONObjectID

case class TemporarySkeletonTracing(
                                     id: String,
                                     dataSetName: String,
                                     _trees: List[TreeLike],
                                     branchPoints: List[BranchPoint],
                                     timestamp: Long,
                                     activeNodeId: Option[Int],
                                     editPosition: Point3D,
                                     editRotation: Vector3D,
                                     zoomLevel: Double,
                                     boundingBox: Option[BoundingBox],
                                     comments: List[Comment] = Nil,
                                     settings: AnnotationSettings = AnnotationSettings.skeletonDefault
                                   ) extends SkeletonTracingLike with AnnotationContent with TreeMergeHelpers{

  type Self = TemporarySkeletonTracing

  def task = None

  def service = TemporarySkeletonTracingService

  def trees = Fox.successful(_trees)

  def allowAllModes =
    this.copy(settings = settings.copy(allowedModes = AnnotationSettings.SKELETON_MODES))

  def temporaryDuplicate(id: String)(implicit ctx: DBAccessContext) =
    Fox.successful(this.copy(id = id))

  def renameTrees(reNamer: TreeLike => String) = {
    this.copy(_trees = _trees.map(tree => tree.changeName(reNamer(tree))))
  }

  def saveToDB(implicit ctx: DBAccessContext) = {
    val s = SkeletonTracing.from(this)
    for{
      saved <- SkeletonTracingService.saveToDB(s)
      _ <- DBTreeService.removeByTracing(saved._id)
      _ <- Fox.successful(_trees.map(DBTreeService.insert(saved._id, _)))
    } yield {
      saved
    }
  }

  def updateFromJson(js: Seq[JsValue])(implicit ctx: DBAccessContext) = ???

  def mergeWith(annotationContent: AnnotationContent)(implicit ctx: DBAccessContext): Fox[TemporarySkeletonTracing] = {
    def mergeBoundingBoxes(aOpt: Option[BoundingBox], bOpt: Option[BoundingBox]) =
      for {
        a <- aOpt
        b <- bOpt
      } yield a.combineWith(b)

    annotationContent match {
      case s: SkeletonTracingLike =>
        s.trees.map{ sourceTrees =>
          val nodeMapping = calculateNodeMapping(sourceTrees, _trees)
          val mergedTrees = mergeTrees(sourceTrees, _trees, nodeMapping)
          val mergedBranchPoints = branchPoints ::: s.branchPoints.map(b => b.copy(id = nodeMapping(b.id)))
          val mergedComments = comments ::: s.comments.map(c => c.copy(node = nodeMapping(c.node)))
          val mergedBoundingBox = mergeBoundingBoxes(boundingBox, s.boundingBox)
          this.copy(_trees = mergedTrees, branchPoints = mergedBranchPoints, comments = mergedComments, boundingBox = mergedBoundingBox)
        }
      case s =>
        Fox.failure("Can't merge annotation content of a different type into TemporarySkeletonTracing. Tried to merge " + s.id)
    }
  }
}

trait TreeMergeHelpers{

  protected def mergeTrees(sourceTrees: List[TreeLike], targetTrees: List[TreeLike], nodeMapping: FunctionalNodeMapping) = {
    val treeMaxId = maxTreeId(targetTrees)

    val mappedSourceTrees = sourceTrees.map(tree =>
      tree.changeTreeId(tree.treeId + treeMaxId).applyNodeMapping(nodeMapping))

    targetTrees ::: mappedSourceTrees
  }

  protected def calculateNodeMapping(sourceTrees: List[TreeLike], targetTrees: List[TreeLike]) = {
    val nodeIdOffset = calculateNodeOffset(sourceTrees, targetTrees)
    (nodeId: Int) => nodeId + nodeIdOffset
  }

  protected def calculateNodeOffset(sourceTrees: List[TreeLike], targetTrees: List[TreeLike]) = {
    if (targetTrees.isEmpty)
      0
    else {
      val targetNodeMaxId = maxNodeId(targetTrees)
      val sourceNodeMinId = minNodeId(sourceTrees)
      math.max(targetNodeMaxId + 1 - sourceNodeMinId, 0)
    }
  }
}
