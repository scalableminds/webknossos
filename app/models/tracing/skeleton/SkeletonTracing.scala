package models.tracing.skeleton

import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{AnnotationContent, AnnotationSettings}
import models.basics._
import models.tracing.skeleton.temporary.TemporarySkeletonTracingService
import oxalis.nml._
import play.api.Logger
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import reactivemongo.play.json.BSONFormats._
import reactivemongo.bson.BSONObjectID

case class SkeletonTracing(
                            dataSetName: String,
                            timestamp: Long,
                            activeNodeId: Option[Int],
                            editPosition: Point3D,
                            editRotation: Vector3D,
                            zoomLevel: Double,
                            boundingBox: Option[BoundingBox],
                            stats: Option[SkeletonTracingStatistics],
                            settings: AnnotationSettings = AnnotationSettings.skeletonDefault,
                            _id: BSONObjectID = BSONObjectID.generate
                          )
  extends SkeletonTracingLike with AnnotationContent with SkeletonManipulations {

  def id = _id.stringify

  type Self = SkeletonTracing

  def service = SkeletonTracingService

  def allowAllModes =
    this.copy(settings = settings.copy(allowedModes = AnnotationSettings.SKELETON_MODES))

  def trees: Fox[List[TreeLike]] = DBTrees.flatMap{ ts =>
    Fox.serialCombined(ts)(t => t.toTree)
  }

  def DBTrees = DBTreeDAO.findByTracing(_id)(GlobalAccessContext)

  def tree(treeId: Int) = DBTreeDAO.findOneByTreeId(_id, treeId)(GlobalAccessContext)

  def maxNodeId = this.trees.map(oxalis.nml.utils.maxNodeId)

  def getOrCollectStatistics: Fox[SkeletonTracingStatistics] = this.stats.toFox.orElse(collectStatistics)

  def toTemporary(implicit ctx: DBAccessContext) =
    temporaryDuplicate(id)

  def temporaryDuplicate(id: String)(implicit ctx: DBAccessContext) = {
    TemporarySkeletonTracingService.createFrom(self, id)
  }

  def saveToDB(implicit ctx: DBAccessContext) = {
    SkeletonTracingService.saveToDB(this)
  }

  def mergeWith(c: AnnotationContent, settings: Option[AnnotationSettings])(implicit ctx: DBAccessContext): Fox[AnnotationContent] = {
    toTemporary.flatMap(_.mergeWith(c, settings))
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
        _ <- SkeletonTracingService.update(updatedTracing._id, updatedTracing.copy(timestamp = System.currentTimeMillis))(GlobalAccessContext)
      } yield updatedTracing
    } else {
      Logger.warn("Failed to parse all update commands from json.")
      Fox.empty
    }
  }

  def collectStatistics: Fox[SkeletonTracingStatistics] = {
    for {
      trees <- this.DBTrees.toFox
      numberOfTrees = trees.size
      (numberOfNodes, numberOfEdges) <- trees.foldLeft(Fox.successful((0l, 0l))) {
        case (f, tree) =>
          for {
            (numberOfNodes, numberOfEdges) <- f.toFox
            nNodes <- tree.numberOfNodes
            nEdges <- tree.numberOfEdges
          } yield {
            (numberOfNodes + nNodes, numberOfEdges + nEdges)
          }
      }
    } yield {
      SkeletonTracingDAO.updateStats(this._id, SkeletonTracingStatistics(numberOfNodes, numberOfEdges, numberOfTrees))(GlobalAccessContext)
      SkeletonTracingStatistics(numberOfNodes, numberOfEdges, numberOfTrees)
    }
  }

  def updateStatistics(update: SkeletonTracingStatistics => Fox[SkeletonTracingStatistics]) =
    this.stats.toFox.flatMap(update).map(stats => this.copy(stats = Some(stats)))
}

object SkeletonTracing {
  implicit val skeletonTracingFormat = Json.format[SkeletonTracing]

  val contentType = "skeletonTracing"

  val defaultZoomLevel = 2.0

//  def from(dataSetName: String, start: Point3D, rotation: Vector3D, settings: AnnotationSettings): SkeletonTracing =
//    SkeletonTracing(
//      dataSetName,
//      Nil,
//      System.currentTimeMillis,
//      None,
//      start,
//      rotation,
//      defaultZoomLevel,
//      None,
//      stats = None,
//      settings = settings)

  def from(t: SkeletonTracingLike) =
    SkeletonTracing(
      t.dataSetName,
      t.timestamp,
      t.activeNodeId,
      t.editPosition,
      t.editRotation,
      t.zoomLevel,
      t.boundingBox,
      t.stats,
      t.settings
    )
}

object SkeletonTracingDAO extends SecuredBaseDAO[SkeletonTracing] with FoxImplicits {

  val collectionName = "skeletons"

  val formatter = SkeletonTracing.skeletonTracingFormat

  def resetComments(_tracing: BSONObjectID)(implicit ctx: DBAccessContext) =
    update(Json.obj("_id" -> _tracing), Json.obj("$set" -> Json.obj("comments" -> Json.arr()), "$unset" -> Json.obj("notUpdated" -> true)))

  def resetBranchPoints(_tracing: BSONObjectID)(implicit ctx: DBAccessContext) =
    update(Json.obj("_id" -> _tracing), Json.obj("$set" -> Json.obj("branchPoints" -> Json.arr()), "$unset" -> Json.obj("notUpdated" -> true)))

  def resetStats(_tracing: BSONObjectID)(implicit ctx: DBAccessContext) =
    update(Json.obj("_id" -> _tracing), Json.obj("$unset" -> Json.obj("stats" -> true)))

  def addBranchPoint(_tracing: BSONObjectID, bp: BranchPoint)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _tracing),
      Json.obj("$set" -> Json.obj(
        "branchPoints.-1" -> bp), "$unset" -> Json.obj("notUpdated" -> true)),
      returnNew = true)

  def addComment(_tracing: BSONObjectID, comment: Comment)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _tracing),
      Json.obj("$set" -> Json.obj(
        "comments.-1" -> comment), "$unset" -> Json.obj("notUpdated" -> true)),
      returnNew = true)

  def updateStats(_tracing: BSONObjectID, stats: SkeletonTracingStatistics)(implicit ctx: DBAccessContext) =
    update(Json.obj("_id" -> _tracing), Json.obj("$set" -> Json.obj("stats" -> stats)))
}
