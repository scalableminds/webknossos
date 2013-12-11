package models.tracing.skeleton

import oxalis.nml.TreeLike
import oxalis.nml.BranchPoint
import braingames.geometry.Scale
import braingames.geometry.Point3D
import oxalis.nml.Comment
import oxalis.nml.NML
import models.annotation._
import play.api.libs.json.JsValue
import org.bson.types.ObjectId
import models.annotation.AnnotationType._
import scala.Some
import oxalis.nml.NML
import models.annotation.AnnotationType.AnnotationType
import scala.concurrent.Future
import oxalis.nml.NML
import scala.Some
import braingames.reactivemongo.DBAccessContext
import braingames.util.Fox
import braingames.binary.models.DataSet
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
                                     comments: List[Comment] = Nil,
                                     settings: AnnotationSettings = AnnotationSettings.default
                                   ) extends SkeletonTracingLike with AnnotationContent {

  type Self = TemporarySkeletonTracing

  def task = None

  def service = TemporarySkeletonTracingService

  def trees = Future.successful(_trees)

  def allowAllModes =
    this.copy(settings = settings.copy(allowedModes = AnnotationSettings.ALL_MODES))

  def insertTree[TemporaryTracing](tree: TreeLike) = {
    Future.successful(this.copy(_trees = tree :: _trees).asInstanceOf[TemporaryTracing])
  }

  def insertBranchPoint[Tracing](bp: BranchPoint) =
    Future.successful(this.copy(branchPoints = bp :: this.branchPoints).asInstanceOf[Tracing])

  def insertComment[Tracing](c: Comment) =
    Future.successful(this.copy(comments = c :: this.comments).asInstanceOf[Tracing])

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
        tracing.comments)
    }
  }

  def createFrom(nmls: List[NML], settings: AnnotationSettings)(implicit ctx: DBAccessContext): Future[Option[TemporarySkeletonTracing]] = {
    nmls match {
      case head :: tail =>
        val startTracing = createFrom(head, "", settings)

        tail.foldLeft(Future.successful(startTracing)) {
          case (f, s) =>
            f.flatMap(t => t.mergeWith(createFrom(s, s.timestamp.toString)))
        }.map(result => Some(result))
      case _ =>
        Future.successful(None)
    }
  }

  type AType = TemporarySkeletonTracing

  def updateSettings(settings: AnnotationSettings, tracingId: String)(implicit ctx: DBAccessContext): Unit = ???

  def findOneById(id: String)(implicit ctx: DBAccessContext): Future[Option[TemporarySkeletonTracingService.AType]] = ???

  def createFrom(dataSet: DataSet)(implicit ctx: DBAccessContext): Future[TemporarySkeletonTracingService.AType] = ???

  def clearTracingData(id: String)(implicit ctx: DBAccessContext): Fox[TemporarySkeletonTracingService.AType] = ???
}