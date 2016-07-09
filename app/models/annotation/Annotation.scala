package models.annotation

import scala.concurrent.Future

import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.reactivemongo.AccessRestrictions.{AllowIf, DenyEveryone}
import com.scalableminds.util.reactivemongo.{DBAccessContext, DefaultAccessDefinitions, GlobalAccessContext, MongoHelpers}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.AnnotationType._
import models.basics._
import models.task.Task
import models.user.User
import org.joda.time.format.DateTimeFormat
import oxalis.view.{ResourceAction, ResourceActionCollection}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import reactivemongo.play.json.BSONFormats._
import reactivemongo.api.indexes.{Index, IndexType}
import reactivemongo.bson.BSONObjectID

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
                       isActive: Boolean = true,
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

  def removeTask() = {
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

  def relativeDownloadUrlOf(typ: String, id: String): String =
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
        "stats" -> stats.map(_.writeAsJson).toOption

      )
    }
  }
}


object AnnotationDAO
  extends SecuredBaseDAO[Annotation]
  with FoxImplicits with MongoHelpers with QuerySupportedDAO[Annotation]{

  val collectionName = "annotations"

  val formatter = Annotation.annotationFormat

  underlying.indexesManager.ensure(Index(Seq("_task" -> IndexType.Ascending)))
  underlying.indexesManager.ensure(Index(Seq("_user" -> IndexType.Ascending, "_task" -> IndexType.Ascending)))

  override def find(query: JsObject = Json.obj())(implicit ctx: DBAccessContext) = {
    super.find(query ++ Json.obj("isActive" -> true))
  }

  override def count(query: JsObject = Json.obj())(implicit ctx: DBAccessContext) = {
    super.count(query ++ Json.obj("isActive" -> true))
  }

  override def findOne(query: JsObject = Json.obj())(implicit ctx: DBAccessContext) = {
    super.findOne(query ++ Json.obj("isActive" -> true))
  }

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
      "state.isAssigned" -> true)).cursor[Annotation]().collect[List]()
  }

  def findFor(_user: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) = withExceptionCatcher{
    find(Json.obj(
      "_user" -> _user,
      "state.isAssigned" -> true,
      "typ" -> annotationType)).cursor[Annotation]().collect[List]()
  }

  def findForWithTypeOtherThan(_user: BSONObjectID, isFinished: Option[Boolean], annotationTypes: List[AnnotationType])(implicit ctx: DBAccessContext) = withExceptionCatcher{
    var q = Json.obj(
      "_user" -> _user,
      "state.isAssigned" -> true,
      "typ" -> Json.obj("$nin" -> annotationTypes))

    isFinished.foreach{ f => q += "state.isFinished" -> JsBoolean(f)}

    find(q).cursor[Annotation]().collect[List]()
  }

  def findFinishedFor(_user: BSONObjectID)(implicit ctx: DBAccessContext) = withExceptionCatcher {
    find(Json.obj(
    "_user" -> _user,
    "state.isFinished" -> true
    )).cursor[Annotation]().collect[List]()
  }

  def findOpenAnnotationsFor(_user: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) = withExceptionCatcher{
    find(defaultFindForUserQ(_user, annotationType)).cursor[Annotation]().collect[List]()
  }

  def countOpenAnnotations(_user: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) =
    count(defaultFindForUserQ(_user, annotationType))

  def removeAllWithTaskId(_task: BSONObjectID)(implicit ctx: DBAccessContext) =
    update(Json.obj("_task" -> _task), Json.obj("$set" -> Json.obj("isActive" -> false)), upsert = false, multi = true)

  def incrementVersion(_annotation: BSONObjectID)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _annotation),
      Json.obj("$inc" -> Json.obj("version" -> 1)),
      returnNew = true)

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

  def updateTeamForAllOfTask(task: Task, team: String)(implicit ctx: DBAccessContext) =
    update(Json.obj("_id" -> task._id), Json.obj("$set" -> Json.obj("team" -> team)))

  def updateAllOfTask(
    task: Task,
    settings: AnnotationSettings)(implicit ctx: DBAccessContext) = {

    find(
      Json.obj(
        "_task" -> task._id)).cursor[Annotation]().collect[List]().map(_.map { annotation =>
      annotation._content.service.updateSettings(settings, annotation._content._id)
    })
  }
  def updateAllOfTask(
    task: Task,
    dataSetName: String,
    boundingBox: Option[BoundingBox],
    settings: AnnotationSettings)(implicit ctx: DBAccessContext) = {

    find(
      Json.obj(
        "_task" -> task._id)).cursor[Annotation]().collect[List]().map(_.map{ annotation =>
          annotation._content.service.updateSettings(dataSetName, boundingBox, settings, annotation._content._id)
    })
  }

  def countAll(implicit ctx: DBAccessContext) =
    count(Json.obj("isActive" -> true))

  def finish(_annotation: BSONObjectID)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _annotation),
      Json.obj("$set" -> Json.obj("state" -> AnnotationState.Finished)),
      returnNew = true)

  def rename(_annotation: BSONObjectID, name: String)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _annotation),
      Json.obj("$set" -> Json.obj("_name" -> name)),
      returnNew = true)

  def reopen(_annotation: BSONObjectID)(implicit ctx: DBAccessContext) =
    updateState(_annotation, AnnotationState.InProgress)

  def updateState(_annotation: BSONObjectID, state: AnnotationState)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _annotation),
      Json.obj("$set" -> Json.obj("state" -> state)),
      returnNew = true)

  def updateContent(_annotation: BSONObjectID, content: ContentReference)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _annotation),
      Json.obj("$set" -> Json.obj(
        "_content" -> content)),
      returnNew = true)

  def transfer(_annotation: BSONObjectID, _user: BSONObjectID)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _annotation),
      Json.obj("$set" -> Json.obj(
        "_user" -> _user)),
      returnNew = true)

  override def executeUserQuery(q: JsObject, limit: Int)(implicit ctx: DBAccessContext): Fox[List[Annotation]] = withExceptionCatcher{
    find(q).cursor[Annotation]().collect[List](maxDocs = limit)
  }
}
