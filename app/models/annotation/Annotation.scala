package models.annotation

import models.basics._
import models.task.{TaskService, TaskDAO, TaskType, Task}
import play.api.libs.json.{Json, JsObject}
import models.user.{UserService, UserDAO, User}
import models.security.Role
import AnnotationType._
import org.joda.time.format.DateTimeFormat
import org.joda.time.DateTime
import braingames.format.Formatter
import oxalis.nml.NML
import braingames.binary.models.DataSet
import braingames.geometry.Point3D
import java.util.Date
import play.api.libs.json.{Json, JsValue}
import play.api.Logger
import models.tracing.skeleton.{SkeletonTracingService, AnnotationStatistics, SkeletonTracing, TemporarySkeletonTracing}
import models.basics.Implicits._
import braingames.util.{Fox, FoxImplicits}
import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.Future
import reactivemongo.bson.BSONObjectID
import braingames.reactivemongo.{DBAccessContext, GlobalAccessContext}
import play.modules.reactivemongo.json.BSONFormats._
import reactivemongo.api.indexes.{IndexType, Index}
import oxalis.view.{ResourceAction, ResourceActionCollection}

case class Annotation(
                       _user: BSONObjectID,
                       _content: ContentReference,
                       _task: Option[BSONObjectID] = None,
                       state: AnnotationState = AnnotationState.InProgress,
                       typ: String = AnnotationType.Explorational,
                       version: Int = 0,
                       _name: Option[String] = None,
                       override val review: List[AnnotationReview] = Nil,
                       _id: BSONObjectID = BSONObjectID.generate
                     )

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

  val restrictions = AnnotationRestrictions.defaultAnnotationRestrictions(this)

  def isReadyToBeFinished(implicit ctx: DBAccessContext) = {
    // TODO: RF - rework
    task
    .flatMap(_.annotationBase.toFox.flatMap(_.statisticsForAnnotation()).map(_.numberOfNodes))
    .getOrElse(1L)
    .flatMap { nodesInBase =>
      this.statisticsForAnnotation().map(_.numberOfNodes > nodesInBase) getOrElse true
    }
  }

  def finishReview(comment: String) = {
    val alteredReview = this.review match {
      case head :: tail =>
        head.copy(comment = Some(comment)) :: tail
      case _ =>
        Nil
    }
    this.copy(review = alteredReview)
  }

  def removeTask = {
    this.copy(_task = None, typ = AnnotationType.Orphan)
  }

  def actions(userOpt: Option[User]) = {
    import controllers.admin.routes._
    import controllers.routes._
    val basicActions = List(
      ResourceAction("trace", AnnotationController.trace(typ,id), icon = Some("icon-random")),
      ResourceAction(ResourceAction.Finish, AnnotationController.finish(typ, id), condition = !state.isFinished, icon = Some("icon-ok-circle"), dataAjax = Some("replace-row,confirm"), clazz = "trace-finish"),
      ResourceAction("start review", TrainingsTracingAdministration.startReview(id), condition = state.isReadyForReview, icon = Some("icon-eye-open"), dataAjax = Some("replace-row")),
      ResourceAction("reopen", AnnotationController.reopen(typ, id), condition = state.isFinished, icon = Some("icon-share-alt"), dataAjax =Some("replace-row")),
      ResourceAction(ResourceAction.Download, AnnotationController.download(typ, id), icon = Some("icon-download")),
      ResourceAction("reset", AnnotationController.reset(typ, id), icon = Some("icon-undo"), dataAjax = Some("replace-row,confirm")),
      ResourceAction("delete", AnnotationController.cancel(typ, id), icon = Some("icon-trash"), dataAjax = Some("delete-row,confirm"))
    )

    val reviewActions = (review.headOption, userOpt) match{
      case (Some(r), Some(user)) if user._id == r._reviewer => List(
        ResourceAction("review", AnnotationController.trace(AnnotationType.Review, r._id.stringify), condition = state.isInReview, icon = Some("icon-random")),
        ResourceAction("finish review", TrainingsTracingAdministration.finishReview(id), condition = state.isInReview, icon = Some("icon-ok-sign")),
        ResourceAction("abort review", TrainingsTracingAdministration.abortReview(id), condition = state.isInReview, icon = Some("icon-remove-sign"), dataAjax = Some("replace-row,confirm")))
      case _ =>
        Nil
    }

    ResourceActionCollection(reviewActions ::: basicActions)
  }
}

object Annotation {
  implicit val annotationFormat = Json.format[Annotation]

  def transformToJson(annotation: Annotation)(implicit ctx: DBAccessContext): Future[JsObject] = {
    for {
      dataSetName <- annotation.dataSetName
      task <- annotation.task.futureBox
      user <- annotation.user
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
        "review" -> annotation.review,
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

  collection.indexesManager.ensure(Index(Seq("_task" -> IndexType.Ascending)))
  collection.indexesManager.ensure(Index(Seq("_user" -> IndexType.Ascending)))

  def findTrainingForReviewAnnotation(annotation: AnnotationLike)(implicit ctx: DBAccessContext) =
    withValidId(annotation.id) {
      id =>
        findOne("review.reviewAnnotation", id)
    }

  def defaultFindForUserQ(_user: BSONObjectID, annotationType: AnnotationType) = Json.obj(
    "_user" -> _user,
    "state.isFinished" -> false,
    "state.isAssigned" -> true,
    "typ" -> annotationType)

  def hasAnOpenAnnotation(_user: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) =
    countOpenAnnotations(_user, annotationType).map(_ > 0)

  def findFor(_user: BSONObjectID)(implicit ctx: DBAccessContext) =
    collectionFind(Json.obj(
      "_user" -> _user,
      "state.isAssigned" -> true)).cursor[Annotation].collect[List]()

  def findFor(_user: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) =
    collectionFind(Json.obj(
      "_user" -> _user,
      "state.isAssigned" -> true,
      "typ" -> annotationType)).cursor[Annotation].collect[List]()


  def findForWithTypeOtherThan(_user: BSONObjectID, annotationTypes: List[AnnotationType])(implicit ctx: DBAccessContext) =
    collectionFind(Json.obj(
      "_user" -> _user,
      "state.isFinished" -> false,
      "state.isAssigned" -> true,
      "typ" -> Json.obj("$nin" -> annotationTypes))).cursor[Annotation].collect[List]()

  def findOpenAnnotationFor(_user: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) =
    collectionFind(defaultFindForUserQ(_user, annotationType)).one[Annotation]

  def findOpenAnnotationsFor(_user: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) =
    collectionFind(defaultFindForUserQ(_user, annotationType)).cursor[Annotation]

  def countOpenAnnotations(_user: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) =
    count(defaultFindForUserQ(_user, annotationType))

  def findOpen(annotationType: AnnotationType)(implicit ctx: DBAccessContext) =
    collectionFind(Json.obj(
      "state.isFinished" -> false,
      "state.isAssigned" -> true,
      "typ" -> annotationType)).cursor[Annotation].collect[List]()

  def removeAllWithTaskId(_task: BSONObjectID)(implicit ctx: DBAccessContext) =
    collectionRemove(Json.obj("_task" -> _task))

  def incrementVersion(_annotation: BSONObjectID)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _annotation),
      Json.obj("$inc" -> Json.obj("version" -> 1)),
      true)

  def findByTaskId(_task: BSONObjectID)(implicit ctx: DBAccessContext) =
    find("_task", _task).collect[List]()

  def findByTaskIdAndType(_task: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) =
    collectionFind(Json.obj(
      "_task" -> _task,
      "typ" -> annotationType,
      "$or" -> Json.arr(
        Json.obj("state.isAssigned" -> true),
        Json.obj("state.isFinished" -> true))))

  def unassignAnnotationsOfUser(_user: BSONObjectID)(implicit ctx: DBAccessContext) =
    collectionUpdate(
      Json.obj(
        "_user" -> _user,
        "typ" -> Json.obj("$in" -> AnnotationType.UserTracings)),
      Json.obj(
        "$set" -> Json.obj(
          "state.isAssigned" -> false)))

  def updateState(annotation: Annotation, state: AnnotationState)(implicit ctx: DBAccessContext) =
    collectionUpdate(
      Json.obj("_id" -> annotation._id),
      Json.obj("$set" -> Json.obj("state" -> state)))

  def updateAllUsingNewTaskType(task: Task, settings: AnnotationSettings)(implicit ctx: DBAccessContext) = {
    collectionFind(
      Json.obj(
        "_task" -> task._id)).one[Annotation].map {
      case Some(annotation) =>
        annotation._content.service.updateSettings(settings, annotation._content._id)
      case _ =>
    }
  }

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
}
