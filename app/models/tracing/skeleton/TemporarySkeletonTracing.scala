package models.tracing.skeleton

import oxalis.nml.TreeLike
import oxalis.nml.BranchPoint
import braingames.geometry.Scale
import braingames.geometry.{Point3D, BoundingBox}
import oxalis.nml.Comment
import oxalis.nml.NML
import models.annotation._
import play.api.libs.json.JsValue

import models.annotation.AnnotationType._
import scala.Some
import oxalis.nml.NML
import models.annotation.AnnotationType.AnnotationType
import scala.concurrent.Future
import oxalis.nml.NML
import scala.Some
import braingames.reactivemongo.DBAccessContext
import braingames.util.Fox
import models.binary.DataSet
import models.basics.SecuredBaseDAO
import play.api.libs.concurrent.Execution.Implicits._

case class TemporarySkeletonTracing(
                                     id: String,
                                     dataSetName: String,
                                     _trees: List[TreeLike],
                                     branchPoints: List[BranchPoint],
                                     timestamp: Long,
                                     activeNodeId: Option[Int],
                                     editPosition: Point3D,
                                     boundingBox: Option[BoundingBox],
                                     comments: List[Comment] = Nil,
                                     settings: AnnotationSettings = AnnotationSettings.skeletonDefault
                                   ) extends SkeletonTracingLike with AnnotationContent {

  type Self = TemporarySkeletonTracing

  def task = None

  def service = TemporarySkeletonTracingService

  def trees = Fox.successful(_trees)

  def allowAllModes =
    this.copy(settings = settings.copy(allowedModes = AnnotationSettings.SKELETON_MODES))

  def insertTree[TemporaryTracing](tree: TreeLike) =
    Fox.successful(this.copy(_trees = tree :: _trees).asInstanceOf[TemporaryTracing])

  def insertBranchPoint[Tracing](bp: BranchPoint) =
    Fox.successful(this.copy(branchPoints = bp :: this.branchPoints).asInstanceOf[Tracing])

  def insertComment[Tracing](c: Comment) =
    Fox.successful(this.copy(comments = c :: this.comments).asInstanceOf[Tracing])

  def updateFromJson(js: Seq[JsValue])(implicit ctx: DBAccessContext) = ???

  def copyDeepAndInsert = ???
}

object TemporarySkeletonTracingService extends AnnotationContentService {
  def createFrom(nml: NML, id: String, settings: AnnotationSettings = AnnotationSettings.default)(implicit ctx: DBAccessContext) = {
    TemporarySkeletonTracing(
      id,
      nml.dataSetName,
      nml.trees,
      nml.branchPoints,
      System.currentTimeMillis(),
      nml.activeNodeId,
      nml.editPosition,
      None,
      nml.comments,
      settings)
  }

  def createFrom(tracing: SkeletonTracingLike, id: String)(implicit ctx: DBAccessContext) = {
    for {
      trees <- tracing.trees
    } yield {
      TemporarySkeletonTracing(
        id,
        tracing.dataSetName,
        trees,
        tracing.branchPoints,
        System.currentTimeMillis(),
        tracing.activeNodeId,
        tracing.editPosition,
        tracing.boundingBox,
        tracing.comments)
    }
  }

  def createFrom(nmls: List[NML], settings: AnnotationSettings)(implicit ctx: DBAccessContext): Fox[TemporarySkeletonTracing] = {
    nmls match {
      case head :: tail =>
        val startTracing = createFrom(head, "", settings)

        tail.foldLeft(Fox.successful(startTracing)) {
          case (f, s) =>
            f.flatMap(t => t.mergeWith(createFrom(s, s.timestamp.toString)))
        }
      case _ =>
        Fox.empty
    }
  }

  type AType = TemporarySkeletonTracing

  def updateSettings(settings: AnnotationSettings, tracingId: String)(implicit ctx: DBAccessContext) = ???

  def findOneById(id: String)(implicit ctx: DBAccessContext) = ???

  def createFrom(dataSet: DataSet)(implicit ctx: DBAccessContext) = ???

  def clearTracingData(id: String)(implicit ctx: DBAccessContext) = ???
}