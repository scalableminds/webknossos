package models.annotation

import com.scalableminds.util.reactivemongo.AccessRestrictions.{DenyEveryone, AllowIf}
import models.basics._
import models.task.{TaskService, TaskDAO, TaskType, Task}
import play.api.libs.json._
import models.user.{UserService, UserDAO, User}
import AnnotationType._
import org.joda.time.format.DateTimeFormat
import org.joda.time.DateTime
import com.scalableminds.util.mvc.Formatter
import oxalis.nml.NML
import com.scalableminds.util.geometry.Point3D
import java.util.Date
import play.api.Logger
import models.basics.Implicits._
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.Future
import reactivemongo.bson.BSONObjectID
import com.scalableminds.util.reactivemongo.{DefaultAccessDefinitions, MongoHelpers, DBAccessContext, GlobalAccessContext}
import play.modules.reactivemongo.json.BSONFormats._
import reactivemongo.api.indexes.{IndexType, Index}
import oxalis.view.{ResourceAction, ResourceActionCollection}
import models.team.Role

case class Annotation(
                       _user: Option[BSONObjectID],
                       _content: ContentReference,
                       _task: Option[BSONObjectID] = None,
                       team: String,
                       state: AnnotationState = AnnotationState.InProgress,
                       typ: String = AnnotationType.Explorational,
                       version: Int = 0,
                       _name: Option[String] = None,
                       created : Long = System.currentTimeMillis,
                       _id: BSONObjectID = BSONObjectID.generate,
                       readOnly: Option[Boolean] = None
                     )

  extends AnnotationLike with FoxImplicits {

  lazy val id = _id.stringify

  lazy val muta = new AnnotationMutations(this)

  /**
   * Easy access methods
   */

  val name = _name getOrElse ""

  def content = _content.resolveAs[AnnotationContent](GlobalAccessContext).toFox

  val contentType = _content.contentType

  val restrictions = if(readOnly.getOrElse(false))
      AnnotationRestrictions.readonlyAnnotation()
    else
      AnnotationRestrictions.defaultAnnotationRestrictions(this)

  def relativeDownloadUrl = Some(Annotation.relativeDownloadUrlOf(typ, id))

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

  def temporaryDuplicate(keepId: Boolean)(implicit ctx: DBAccessContext) = {
    for{
      contentDuplicate <- content.flatMap(c => c.temporaryDuplicate(if(keepId) c.id else BSONObjectID.generate.stringify))
    } yield {
      TemporaryAnnotationService.createFrom(
        this,
        if(keepId) this.id else BSONObjectID.generate.stringify,
        contentDuplicate)
    }
  }

  def makeReadOnly: AnnotationLike = {
    this.copy(readOnly = Some(true))
  }

  def saveToDB(implicit ctx: DBAccessContext): Fox[Annotation] = {
    AnnotationService.saveToDB(this)
  }

  def actions(userOpt: Option[User]) = {
    import controllers.admin.routes._
    import controllers.routes._
    val traceOrView = if(restrictions.allowUpdate(userOpt)) "trace" else "view"
    val basicActions = List(
      ResourceAction(traceOrView, AnnotationController.trace(typ,id), icon = Some("fa fa-random")),
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

  def relativeDownloadUrlOf(typ: String, id: String) =
    controllers.routes.AnnotationController.download(typ, id).url

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
  with FoxImplicits with MongoHelpers{

  val collectionName = "annotations"

  val formatter = Annotation.annotationFormat

  underlying.indexesManager.ensure(Index(Seq("_task" -> IndexType.Ascending)))
  underlying.indexesManager.ensure(Index(Seq("_user" -> IndexType.Ascending)))
  underlying.indexesManager.ensure(Index(Seq("_user" -> IndexType.Ascending, "_task" -> IndexType.Ascending)))

  override val AccessDefinitions = new DefaultAccessDefinitions{

    override def findQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match{
        case Some(user: User) =>
          AllowIf(Json.obj(
            "$or" -> Json.arr(
              Json.obj("team" -> Json.obj("$in" -> user.teamNames)),
              Json.obj("_user"-> user._id))
          ))
        case _ =>
          DenyEveryone()
      }
    }

    override def removeQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match{
        case Some(user: User) =>
          AllowIf(Json.obj(
            "$or" -> Json.arr(
              Json.obj("team" -> Json.obj("$in" -> user.adminTeamNames)),
              Json.obj("_user"-> user._id))
            ))
        case _ =>
          DenyEveryone()
      }
    }
  }

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

  def finishAllWithTaskId(_task: BSONObjectID)(implicit ctx: DBAccessContext) =
    update(
      Json.obj("_task" -> _task),
      Json.obj("$set" -> Json.obj("state" -> AnnotationState.Finished)),
      multi = true)

  def incrementVersion(_annotation: BSONObjectID)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _annotation),
      Json.obj("$inc" -> Json.obj("version" -> 1)),
      true)

  def findByTaskId(_task: BSONObjectID)(implicit ctx: DBAccessContext) = withExceptionCatcher{
    find("_task", _task).collect[List]()
  }

  def findByTaskIdAndUser(_user: BSONObjectID, _task: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) = withExceptionCatcher{
    find(Json.obj(
      "_task" -> _task,
      "typ" -> annotationType,
      "_user" -> _user)).one[Annotation]
  }

  def findByTaskIdAndType(_task: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) =
    find(Json.obj(
      "_task" -> _task,
      "typ" -> annotationType,
      "$or" -> Json.arr(
        Json.obj("state.isAssigned" -> true),
        Json.obj("state.isFinished" -> true))))

  def countUnfinishedByTaskIdAndType(_task: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) =
    count(Json.obj(
      "_task" -> _task,
      "typ" -> annotationType,
      "state.isAssigned" -> true,
      "state.isFinished" -> false))

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
