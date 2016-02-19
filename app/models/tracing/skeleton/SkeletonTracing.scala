package models.tracing.skeleton

import com.scalableminds.util.geometry.{Point3D, BoundingBox}
import models.annotation._
import models.task.Task
import CompoundAnnotation._
import models.tracing.skeleton.temporary.{TemporarySkeletonTracingService, TemporarySkeletonTracing}
import play.api.Logger
import play.api.libs.json._
import models.user.{User, UsedAnnotationDAO, UsedAnnotation}
import models.basics._
import oxalis.nml._
import models.annotation.{AnnotationState, AnnotationContentService, AnnotationSettings, AnnotationContent}
import models.tracing.{CommonTracing, CommonTracingService}
import models.binary.DataSet
import oxalis.nml.NML
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.reactivemongo.GlobalAccessContext
import reactivemongo.bson.BSONObjectID
import play.api.libs.concurrent.Execution.Implicits._
import play.modules.reactivemongo.json.BSONFormats._
import com.scalableminds.util.tools.{FoxImplicits, Fox}

case class SkeletonTracing(
                            dataSetName: String,
                            branchPoints: List[BranchPoint],
                            timestamp: Long,
                            activeNodeId: Option[Int],
                            editPosition: Point3D,
                            zoomLevel: Double,
                            boundingBox: Option[BoundingBox],
                            comments: List[Comment] = Nil,
                            settings: AnnotationSettings = AnnotationSettings.skeletonDefault,
                            _id: BSONObjectID = BSONObjectID.generate
                          )
  extends SkeletonTracingLike with AnnotationContent with CommonTracing with SkeletonManipulations {

  def id = _id.stringify

  type Self = SkeletonTracing

  def service = SkeletonTracingService

  def allowAllModes =
    this.copy(settings = settings.copy(allowedModes = AnnotationSettings.SKELETON_MODES))

  def trees: Fox[List[TreeLike]] = DBTrees.flatMap{ ts =>
    Fox.combined(ts.map(t => t.toTree))
  }

  def DBTrees = DBTreeDAO.findByTracing(_id)(GlobalAccessContext)

  def tree(treeId: Int) = DBTreeDAO.findOneByTreeId(_id, treeId)(GlobalAccessContext)

  def maxNodeId = this.trees.map(oxalis.nml.utils.maxNodeId)

  def toTemporary(implicit ctx: DBAccessContext) =
    temporaryDuplicate(id)

  def temporaryDuplicate(id: String)(implicit ctx: DBAccessContext) = {
    TemporarySkeletonTracingService.createFrom(self, id)
  }

  def saveToDB(implicit ctx: DBAccessContext) = {
    SkeletonTracingService.saveToDB(this)
  }

  def mergeWith(c: AnnotationContent)(implicit ctx: DBAccessContext): Fox[AnnotationContent] = {
    toTemporary.flatMap(_.mergeWith(c))
  }
}

trait SkeletonManipulations extends FoxImplicits {
  this: SkeletonTracing =>

  def updateFromJson(jsUpdates: Seq[JsValue])(implicit ctx: DBAccessContext): Fox[SkeletonTracing] = {
    val updates = jsUpdates.flatMap { json =>
      TracingUpdater.createUpdateFromJson(json)
    }
    if (jsUpdates.size == updates.size) {
      for {
        updatedTracing <- updates.foldLeft(Fox.successful(this)) {
          case (f, updater) => f.flatMap(tracing => updater.update(tracing))
        }
        _ <- SkeletonTracingDAO.update(updatedTracing._id, updatedTracing.copy(timestamp = System.currentTimeMillis))(GlobalAccessContext)
      } yield updatedTracing
    } else {
      Logger.warn("Failed to parse all update commands from json.")
      Fox.empty
    }
  }
}

object SkeletonTracing {
  implicit val skeletonTracingFormat = Json.format[SkeletonTracing]

  val contentType = "skeletonTracing"

  val defaultZoomLevel = 2.0

  def from(dataSetName: String, start: Point3D, settings: AnnotationSettings): SkeletonTracing =
    SkeletonTracing(
      dataSetName,
      Nil,
      System.currentTimeMillis,
      None,
      start,
      defaultZoomLevel,
      None,
      settings = settings)

  def from(t: SkeletonTracingLike) =
    SkeletonTracing(
      t.dataSetName,
      t.branchPoints,
      t.timestamp,
      t.activeNodeId,
      t.editPosition,
      t.zoomLevel,
      t.boundingBox,
      t.comments,
      t.settings
    )
}

object SkeletonTracingDAO extends SecuredBaseDAO[SkeletonTracing] with FoxImplicits {

  val collectionName = "skeletons"

  val formatter = SkeletonTracing.skeletonTracingFormat

  @deprecated(":D", "2.2")
  override def removeById(tracing: BSONObjectID)(implicit ctx: DBAccessContext) = {
    super.removeById(tracing)
  }

  def resetComments(_tracing: BSONObjectID)(implicit ctx: DBAccessContext) =
    update(Json.obj("_id" -> _tracing), Json.obj("$set" -> Json.obj("comments" -> Json.arr())))

  def resetBranchPoints(_tracing: BSONObjectID)(implicit ctx: DBAccessContext) =
    update(Json.obj("_id" -> _tracing), Json.obj("$set" -> Json.obj("branchPoints" -> Json.arr())))

  def addBranchPoint(_tracing: BSONObjectID, bp: BranchPoint)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _tracing),
      Json.obj("$set" -> Json.obj(
        "branchPoints.-1" -> bp)),
      true)

  def addComment(_tracing: BSONObjectID, comment: Comment)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _tracing),
      Json.obj("$set" -> Json.obj(
        "comments.-1" -> comment)),
      true)
}
