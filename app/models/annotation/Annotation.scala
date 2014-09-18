package models.annotation

import models.annotation.AnnotationBaseRestrictions
import models.basics._
import models.task.{TaskService, TaskDAO, TaskType, Task}
import play.api.libs.json.{Json, JsObject}
import models.user.{UserService, UserDAO, User}
import AnnotationType._
import org.joda.time.format.DateTimeFormat
import org.joda.time.DateTime
import com.scalableminds.util.mvc.Formatter
import oxalis.nml.NML
import com.scalableminds.util.geometry.Point3D
import java.util.Date
import play.api.libs.json.{Json, JsValue}
import play.api.Logger
import models.tracing.skeleton.{SkeletonTracingService, AnnotationStatistics, SkeletonTracing, TemporarySkeletonTracing}
import models.basics.Implicits._
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.Future
import reactivemongo.bson.BSONObjectID
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import play.modules.reactivemongo.json.BSONFormats._
import reactivemongo.api.indexes.{IndexType, Index}
import oxalis.view.{ResourceAction, ResourceActionCollection}
import models.team.Role

case class Annotation(
                       _user: BSONObjectID,
                       _content: ContentReference,
                       _task: Option[BSONObjectID] = None,
                       team: String,
                       state: AnnotationState = AnnotationState.InProgress,
                       typ: String = AnnotationType.Explorational,
                       version: Int = 0,
                       _name: Option[String] = None,
                       created : Long = System.currentTimeMillis,
                       _id: BSONObjectID = BSONObjectID.generate)
                     (implicit _restrictions: Option[AnnotationBaseRestrictions] = None)

  extends AnnotationLike with FoxImplicits {

  lazy val id = _id.stringify

  lazy val muta = new AnnotationMutations(this)

  /**
   * Easy access methods
   */

  val name = _name getOrElse ""

  def task = _task.toFox.flatMap(id => TaskDAO.findOneById(id)(GlobalAccessContext))

  def user = UserService.findOneById(_user.stringify, useCache = true)(GlobalAccessContext)

  def content = _content.resolveAs[AnnotationContent](GlobalAccessContext).toFox

  val contentType = _content.contentType

  def restrictions = _restrictions match {
    case Some(restrictions) => restrictions
    case None => AnnotationRestrictions.defaultAnnotationRestrictions(this)
  }

  def isReadyToBeFinished(implicit ctx: DBAccessContext) = {
    // TODO: RF - rework
    task
    .flatMap(_.annotationBase.toFox.flatMap(_.statisticsForAnnotation()).map(_.numberOfNodes))
    .getOrElse(1L)
    .flatMap { nodesInBase =>
      this.statisticsForAnnotation().map(_.numberOfNodes > nodesInBase) getOrElse true
    }
  }

  def removeTask = {
    this.copy(_task = None, typ = AnnotationType.Orphan)
  }

  def actions(userOpt: Option[User]) = {
    import controllers.admin.routes._
    import controllers.routes._
    val basicActions = List(
      ResourceAction("trace", AnnotationController.trace(typ,id), icon = Some("fa fa-random")),
      ResourceAction(ResourceAction.Finish, AnnotationController.finish(typ, id), condition = !state.isFinished, icon = Some("fa fa-check-circle-o"), isAjax = true, clazz = "trace-finish"),
      ResourceAction("reopen", AnnotationController.reopen(typ, id), condition = state.isFinished, icon = Some("fa fa-share"), isAjax = true),
      ResourceAction(ResourceAction.Download, AnnotationController.download(typ, id), icon = Some("fa fa-download")),
      ResourceAction("reset", AnnotationController.reset(typ, id), icon = Some("fa fa-undo"), isAjax = true)
    )

    ResourceActionCollection(basicActions)
  }
}

object Annotation {

  implicit val annotationFormat = Json.format[Annotation]

  def transformToJson(annotation: Annotation)(implicit ctx: DBAccessContext): Future[JsObject] = {
    for {
      dataSetName <- annotation.dataSetName
      task <- annotation.task.futureBox
      user <- annotation.user.futureBox
      content <- annotation.content.futureBox
      contentType = content.map(_.contentType).getOrElse("")
      stats <- annotation.statisticsForAnnotation().futureBox
    } yield {
      Json.obj(
        "created" -> content.map(annotationContent => DateTimeFormat.forPattern("yyyy-MM-dd HH:mm").print(annotationContent.timestamp)).toOption,
        "contentType" -> contentType,
        "dataSetName" -> dataSetName,
        "state" -> annotation.state,
        "typ" -> annotation.typ,
        "name" -> annotation.name,
        "id" -> annotation.id,
        "formattedHash" -> Formatter.formatHash(annotation.id),
        "stats" -> stats.toOption

      )
    }
  }
}


object AnnotationDAO
  extends SecuredBaseDAO[Annotation]
  with FoxImplicits {

  val collectionName = "annotations"

  val formatter = Annotation.annotationFormat

  underlying.indexesManager.ensure(Index(Seq("_task" -> IndexType.Ascending)))
  underlying.indexesManager.ensure(Index(Seq("_user" -> IndexType.Ascending)))

  def defaultFindForUserQ(_user: BSONObjectID, annotationType: AnnotationType) = Json.obj(
    "_user" -> _user,
    "state.isFinished" -> false,
    "state.isAssigned" -> true,
    "typ" -> annotationType)

  def hasAnOpenAnnotation(_user: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) =
    countOpenAnnotations(_user, annotationType).map(_ > 0)

  def findFor(_user: BSONObjectID)(implicit ctx: DBAccessContext) = withExceptionCatcher{
    find(Json.obj(
      "_user" -> _user,
      "state.isAssigned" -> true)).cursor[Annotation].collect[List]()
  }

  def findFor(_user: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) = withExceptionCatcher{
    find(Json.obj(
      "_user" -> _user,
      "state.isAssigned" -> true,
      "typ" -> annotationType)).cursor[Annotation].collect[List]()
  }


  def findForWithTypeOtherThan(_user: BSONObjectID, annotationTypes: List[AnnotationType])(implicit ctx: DBAccessContext) = withExceptionCatcher{
    find(Json.obj(
      "_user" -> _user,
      "state.isFinished" -> false,
      "state.isAssigned" -> true,
      "typ" -> Json.obj("$nin" -> annotationTypes))).cursor[Annotation].collect[List]()
  }

  def findOpenAnnotationFor(_user: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) =
    findOne(defaultFindForUserQ(_user, annotationType))

  def findOpenAnnotationsFor(_user: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) = withExceptionCatcher{
    find(defaultFindForUserQ(_user, annotationType)).cursor[Annotation].collect[List]()
  }

  def countOpenAnnotations(_user: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) =
    count(defaultFindForUserQ(_user, annotationType))

  def findOpen(annotationType: AnnotationType)(implicit ctx: DBAccessContext) = withExceptionCatcher{
    find(Json.obj(
      "state.isFinished" -> false,
      "state.isAssigned" -> true,
      "typ" -> annotationType)).cursor[Annotation].collect[List]()
  }

  def removeAllWithTaskId(_task: BSONObjectID)(implicit ctx: DBAccessContext) =
    remove(Json.obj("_task" -> _task))

  def incrementVersion(_annotation: BSONObjectID)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _annotation),
      Json.obj("$inc" -> Json.obj("version" -> 1)),
      true)

  def findByTaskId(_task: BSONObjectID)(implicit ctx: DBAccessContext) = withExceptionCatcher{
    find("_task", _task).collect[List]()
  }

  def findByTaskIdAndType(_task: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) =
    find(Json.obj(
      "_task" -> _task,
      "typ" -> annotationType,
      "$or" -> Json.arr(
        Json.obj("state.isAssigned" -> true),
        Json.obj("state.isFinished" -> true))))

  def unassignAnnotationsOfUser(_user: BSONObjectID)(implicit ctx: DBAccessContext) =
    update(
      Json.obj(
        "_user" -> _user,
        "typ" -> Json.obj("$in" -> AnnotationType.UserTracings)),
      Json.obj(
        "$set" -> Json.obj(
          "state.isAssigned" -> false)))

  def updateState(annotation: Annotation, state: AnnotationState)(implicit ctx: DBAccessContext) =
    update(
      Json.obj("_id" -> annotation._id),
      Json.obj("$set" -> Json.obj("state" -> state)))

  def updateAllUsingNewTaskType(task: Task, settings: AnnotationSettings)(implicit ctx: DBAccessContext) = {
    find(
      Json.obj(
        "_task" -> task._id)).one[Annotation].map {
      case Some(annotation) =>
        annotation._content.service.updateSettings(settings, annotation._content._id)
      case _ =>
    }
  }

  def countAll(implicit ctx: DBAccessContext) =
    count(Json.obj())

  def finish(_annotation: BSONObjectID)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _annotation),
      Json.obj("$set" -> Json.obj("state" -> AnnotationState.Finished)),
      true)

  def rename(_annotation: BSONObjectID, name: String)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _annotation),
      Json.obj("$set" -> Json.obj("_name" -> name)),
      true)

  def reopen(_annotation: BSONObjectID)(implicit ctx: DBAccessContext) =
    updateState(_annotation, AnnotationState.InProgress)

  def passToReview(_annotation: BSONObjectID)(implicit ctx: DBAccessContext) =
    updateState(_annotation, AnnotationState.InReview)

  def updateState(_annotation: BSONObjectID, state: AnnotationState)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _annotation),
      Json.obj("$set" -> Json.obj("state" -> state)),
      true)

  def assignReviewer(_annotation: BSONObjectID, annotationReview: AnnotationReview)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _annotation),
      Json.obj("$set" -> Json.obj(
        "state" -> AnnotationState.InReview,
        "review.-1" -> annotationReview)),
      true)

  def addReviewComment(_annotation: BSONObjectID, comment: String)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _annotation),
      Json.obj("$set" -> Json.obj(
        "review.0.comment" -> comment)),
      true)

  def updateContent(_annotation: BSONObjectID, content: ContentReference)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _annotation),
      Json.obj("$set" -> Json.obj(
        "_content" -> content)),
      true)

  def unassignReviewer(_annotation: BSONObjectID)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _annotation),
      Json.obj("$set" -> Json.obj(
        "state" -> AnnotationState.ReadyForReview),
        "$pop" -> Json.obj("review" -> -1)),
      true)

  def transfer(_annotation: BSONObjectID, _user: BSONObjectID)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _annotation),
      Json.obj("$set" -> Json.obj(
        "_user" -> _user)),
      true)
}
