package models.tracing.skeleton

import braingames.geometry.Point3D
import play.api.libs.json._
import models.binary.DataSetDAO
import models.user.{UsedAnnotationDAO, UsedAnnotation}
import braingames.geometry.Scale
import braingames.image.Color
import models.basics._
import oxalis.nml._
import braingames.binary.models.DataSet
import models.annotation.{AnnotationState, AnnotationContentService, AnnotationSettings, AnnotationContent}
import models.tracing.CommonTracingService
import scala.Some
import braingames.binary.models.DataSet
import oxalis.nml.NML
import braingames.reactivemongo.DBAccessContext
import scala.tools.nsc.Global
import braingames.reactivemongo.GlobalAccessContext
import reactivemongo.bson.BSONObjectID
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import play.modules.reactivemongo.json.BSONFormats._
import braingames.util.{FoxImplicits, Fox}
import net.liftweb.common.Empty
import play.api.Logger

case class SkeletonTracing(
                            dataSetName: String,
                            branchPoints: List[BranchPoint],
                            timestamp: Long,
                            activeNodeId: Option[Int],
                            editPosition: Point3D,
                            comments: List[Comment] = Nil,
                            settings: AnnotationSettings = AnnotationSettings.default,
                            _id: BSONObjectID = BSONObjectID.generate
                          )
  extends SkeletonTracingLike with AnnotationContent with SkeletonManipulations {

  def id = _id.stringify

  type Self = SkeletonTracing

  def service = SkeletonTracingService

  def allowAllModes =
    this.copy(settings = settings.copy(allowedModes = AnnotationSettings.ALL_MODES))

  /**
   * Tree modification
   */
  def trees: Future[List[TreeLike]] = dbtrees.flatMap(ts => Future.traverse(ts)(t => t.toTree))

  def dbtrees = DBTreeDAO.findByTracing(_id)(GlobalAccessContext)

  def tree(treeId: Int) = DBTreeDAO.findOneByTreeId(_id, treeId)(GlobalAccessContext)

  def maxNodeId = this.trees.map(oxalis.nml.utils.maxNodeId)

  override def mergeWith(c: AnnotationContent): Future[SkeletonTracing] = {
    c match {
      case c: SkeletonTracingLike =>
        super.mergeWith(c)
      case e =>
        throw new Exception("Can't merge SkeletonTracing with: " + e)
    }
  }
}

trait SkeletonManipulations extends FoxImplicits {
  this: SkeletonTracing =>

  def insertTree[Tracing](t: TreeLike): Future[Tracing] =
    DBTreeService.insert(this._id, t)(GlobalAccessContext).map { _ => this.asInstanceOf[Tracing] }

  def insertBranchPoint[Tracing](bp: BranchPoint): Future[Tracing] =
    SkeletonTracingDAO.addBranchPoint(this._id, bp)(GlobalAccessContext).map(_.getOrElse(this)).asInstanceOf[Future[Tracing]]

  def insertComment[Tracing](c: Comment): Future[Tracing] =
    SkeletonTracingDAO.addComment(this._id, c)(GlobalAccessContext).map(_.getOrElse(this)).asInstanceOf[Future[Tracing]]

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
      } yield Some(updatedTracing)
    } else {
      Future.successful(Empty)
    }
  }

  def copyDeepAndInsert() = {
    val copied = this.copy(
      _id = BSONObjectID.generate,
      branchPoints = Nil,
      comments = Nil)
    for {
      _ <- SkeletonTracingDAO.insert(copied)(GlobalAccessContext)
      result <- SkeletonTracingService.mergeWith(this, copied)(GlobalAccessContext)
    } yield result
  }
}

object SkeletonTracing {
  implicit val skeletonTracingFormat = Json.format[SkeletonTracing]

  val contentType = "skeletonTracing"

  def from(settings: AnnotationSettings, dataSetName: String): SkeletonTracing =
    SkeletonTracing(
      dataSetName,
      Nil,
      System.currentTimeMillis,
      None,
      Point3D(0, 0, 0),
      settings = settings)

  def from(t: SkeletonTracingLike) =
    SkeletonTracing(
      t.dataSetName,
      t.branchPoints,
      t.timestamp,
      t.activeNodeId,
      t.editPosition,
      t.comments,
      t.settings
    )
}

object SkeletonTracingService extends AnnotationContentService with CommonTracingService with AnnotationStatistics {
  val dao = SkeletonTracingDAO

  type AType = SkeletonTracing

  def createFrom(dataSetName: String, start: Point3D, insertStartAsNode: Boolean, settings: AnnotationSettings = AnnotationSettings.default)(implicit ctx: DBAccessContext): Future[SkeletonTracing] = {
    val trees =
      if (insertStartAsNode)
        List(Tree.createFrom(start))
      else
        Nil

    createFrom(
      TemporarySkeletonTracing(
        "",
        dataSetName,
        trees,
        Nil,
        System.currentTimeMillis(),
        Some(1),
        start,
        Nil,
        settings))
  }

  def clearTracingData(tracingId: String)(implicit ctx: DBAccessContext) = {
    SkeletonTracingDAO.withValidId(tracingId) { _tracing =>
      for {
        _ <- DBTreeService.removeByTracing(_tracing)
        - <- SkeletonTracingDAO.resetBranchPoints(_tracing)
        - <- SkeletonTracingDAO.resetComments(_tracing)
        tracing <- SkeletonTracingDAO.findOneById(_tracing)
      } yield tracing
    }
  }

  def createFrom(tracingLike: SkeletonTracingLike)(implicit ctx: DBAccessContext): Future[SkeletonTracing] = {
    val tracing = SkeletonTracing.from(tracingLike)
    for {
      _ <- SkeletonTracingDAO.insert(tracing)
      trees <- tracingLike.trees
      - <- Future.traverse(trees)(tree => DBTreeService.insert(tracing._id, tree))
    } yield tracing
  }

  def createFrom(nmls: List[NML], settings: AnnotationSettings)(implicit ctx: DBAccessContext): Future[Option[SkeletonTracing]] = {
    TemporarySkeletonTracingService.createFrom(nmls, settings).flatMap {
      case Some(temporary) =>
        createFrom(temporary).map(t => Some(t))
      case _ =>
        Future.successful(None)
    }
  }

  def createFrom(nml: NML, settings: AnnotationSettings)(implicit ctx: DBAccessContext): Future[Option[SkeletonTracing]] = {
    createFrom(List(nml), settings)
  }

  def createFrom(dataSet: DataSet)(implicit ctx: DBAccessContext): Future[SkeletonTracing] =
    createFrom(dataSet.name, Point3D(0, 0, 0), false)

  def mergeWith(source: SkeletonTracing, target: SkeletonTracing)(implicit ctx: DBAccessContext): Future[SkeletonTracing] = {
    target.mergeWith(source).flatMap { merged =>
      SkeletonTracingDAO.update(target._id, merged).map { _ => merged }
    }
  }

  def removeById(_skeleton: BSONObjectID)(implicit ctx: DBAccessContext) =
    for {
      _ <- UsedAnnotationDAO.removeAll(_skeleton.stringify)
      _ <- DBTreeService.removeByTracing(_skeleton)
      _ <- SkeletonTracingDAO.removeById(_skeleton)
    } yield true


  def findOneById(tracingId: String)(implicit ctx: DBAccessContext) =
    SkeletonTracingDAO.findOneById(tracingId)
}

object SkeletonTracingDAO extends SecuredBaseDAO[SkeletonTracing] with FoxImplicits {

  val collectionName = "skeletons"

  val formatter = SkeletonTracing.skeletonTracingFormat

  @deprecated(":D", "2.2")
  override def removeById(tracing: BSONObjectID)(implicit ctx: DBAccessContext) = {
    super.removeById(tracing)
  }

  def resetComments(_tracing: BSONObjectID)(implicit ctx: DBAccessContext) =
    collectionUpdate(Json.obj("_id" -> _tracing), Json.obj("$set" -> Json.obj("comments" -> Json.arr())))

  def resetBranchPoints(_tracing: BSONObjectID)(implicit ctx: DBAccessContext) =
    collectionUpdate(Json.obj("_id" -> _tracing), Json.obj("$set" -> Json.obj("branchPoints" -> Json.arr())))

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
