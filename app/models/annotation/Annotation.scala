package models.annotation

import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.reactivemongo.AccessRestrictions.{AllowIf, DenyEveryone}
import com.scalableminds.util.reactivemongo.{DBAccessContext, DefaultAccessDefinitions, GlobalAccessContext, MongoHelpers}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.AnnotationType._
import models.basics._
import models.task.{Task, TaskDAO}
import models.user.{User, UserService}
import org.joda.time.format.DateTimeFormat
import oxalis.mvc.FilterableJson
import oxalis.view.{ResourceAction, ResourceActionCollection}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import reactivemongo.api.indexes.{Index, IndexType}
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._

case class Annotation(
                       _user: Option[BSONObjectID],
                       contentReference: ContentReference,
                       dataSetName: String,
                       team: String,
                       settings: AnnotationSettings,
                       statistics: JsObject = Json.obj(),
                       typ: String = AnnotationType.Explorational,
                       isActive: Boolean = true,
                       state: AnnotationState = AnnotationState.InProgress,
                       created : Long = System.currentTimeMillis,
                       tracingTime: Option[Long] = None,
                       readOnly: Option[Boolean] = None,
                       _name: Option[String] = None,
                       _task: Option[BSONObjectID] = None,
                       _id: BSONObjectID = BSONObjectID.generate
                     )
  extends FoxImplicits {

  lazy val id = _id.stringify

  lazy val muta = new AnnotationMutations(this)

  def user: Fox[User] =
    _user.toFox.flatMap(u => UserService.findOneById(u.stringify, useCache = true)(GlobalAccessContext))

  def task: Fox[Task] =
    _task.toFox.flatMap(id => TaskDAO.findOneById(id)(GlobalAccessContext))

  val name = _name.getOrElse("")

  val stateLabel = if (state.isFinished) "Finished" else "In Progress"

  val contentType = contentReference.contentType

  val restrictions = if(readOnly.getOrElse(false))
      AnnotationRestrictions.readonlyAnnotation()
    else
      AnnotationRestrictions.defaultAnnotationRestrictions(this)

  def removeTask() = {
    this.copy(_task = None, typ = AnnotationType.Orphan)
  }

  def makeReadOnly: Annotation = {
    this.copy(readOnly = Some(true))
  }

  def saveToDB(implicit ctx: DBAccessContext): Fox[Annotation] = {
    AnnotationService.saveToDB(this)
  }

  def annotationInfo(user: Option[User])(implicit ctx: DBAccessContext): Fox[JsObject] =
    toJson(user)

  def isRevertPossible: Boolean = {
    // Unfortunately, we can not revert all tracings, because we do not have the history for all of them
    // hence we need a way to decide if a tracing can safely be revert. We will use the created date of the
    // annotation to do so
    created > 1470002400000L  // 1.8.2016, 00:00:00
  }

  def toJson(user: Option[User] = None)(implicit ctx: DBAccessContext): Fox[JsObject] = {
    for {
      taskJson <- task.flatMap(t => Task.transformToJson(t, user)).getOrElse(JsNull)
      userJson = user.map(u => User.userCompactWrites.writes(u)).getOrElse(JsNull)
    } yield {
      Json.obj(
        "user" -> userJson,
        "created" -> DateTimeFormat.forPattern("yyyy-MM-dd HH:mm").print(created),
        "stateLabel" -> stateLabel,
        "state" -> state,
        "id" -> id,
        "name" -> name,
        "typ" -> typ,
        "task" -> taskJson,
        "stats" -> statistics,
        "restrictions" -> AnnotationRestrictions.writeAsJson(restrictions, user),
        "actions" -> actions(user),
        "formattedHash" -> Formatter.formatHash(id),
        "content" -> contentReference,
        "dataSetName" -> dataSetName,
        "tracingTime" -> tracingTime
      )
    }
  }
}


object Annotation  {implicit val annotationFormat = Json.format[Annotation]}






object AnnotationDAO
  extends SecuredBaseDAO[Annotation]
  with FoxImplicits with MongoHelpers with QuerySupportedDAO[Annotation]{

  val collectionName = "annotations"

  val formatter = Annotation.annotationFormat

  underlying.indexesManager.ensure(Index(Seq("isActive" -> IndexType.Ascending, "_task" -> IndexType.Ascending)))
  underlying.indexesManager.ensure(Index(Seq("isActive" -> IndexType.Ascending, "_user" -> IndexType.Ascending, "_task" -> IndexType.Ascending)))

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

  def findFor(_user: BSONObjectID, isFinished: Option[Boolean], annotationType: AnnotationType, limit: Int)(implicit ctx: DBAccessContext) = withExceptionCatcher{
    var q = Json.obj(
      "_user" -> _user,
      "state.isAssigned" -> true,
      "typ" -> annotationType)

    isFinished.foreach{ f => q += "state.isFinished" -> JsBoolean(f)}

    find(q).sort(Json.obj("_id" -> -1)).cursor[Annotation]().collect[List](maxDocs = limit)
  }

  def logTime(time: Long, _annotation: BSONObjectID)(implicit ctx: DBAccessContext) =
    update(Json.obj("_id" -> _annotation), Json.obj("$inc" -> Json.obj("tracingTime" -> time)))

  def findForWithTypeOtherThan(_user: BSONObjectID, isFinished: Option[Boolean], annotationTypes: List[AnnotationType], limit: Int)(implicit ctx: DBAccessContext) = withExceptionCatcher{
    var q = Json.obj(
      "_user" -> _user,
      "state.isAssigned" -> true,
      "typ" -> Json.obj("$nin" -> annotationTypes))

    isFinished.foreach{ f => q += "state.isFinished" -> JsBoolean(f)}

    find(q).sort(Json.obj("_id" -> -1)).cursor[Annotation]().collect[List](maxDocs = limit)
  }

  def findOpenAnnotationsFor(_user: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) = withExceptionCatcher{
    find(defaultFindForUserQ(_user, annotationType)).cursor[Annotation]().collect[List]()
  }

  def countOpenAnnotations(_user: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) =
    count(defaultFindForUserQ(_user, annotationType))

  def removeAllWithTaskId(_task: BSONObjectID)(implicit ctx: DBAccessContext) =
    update(Json.obj("isActive" -> true, "_task" -> _task), Json.obj("$set" -> Json.obj("isActive" -> false)), upsert = false, multi = true)

  def incrementVersion(_annotation: BSONObjectID)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _annotation),
      Json.obj("$inc" -> Json.obj("version" -> 1)),
      returnNew = true)

  def countByTaskIdAndUser(_user: BSONObjectID, _task: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) = withExceptionCatcher{
    count(Json.obj(
      "_task" -> _task,
      "typ" -> annotationType,
      "_user" -> _user))
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

  def updateSettingsForAllOfTask(task: Task, settings: AnnotationSettings)(implicit ctx: DBAccessContext) = {
    update(
      Json.obj("_task" -> task._id),
      Json.obj("$set" -> Json.obj("settings" -> settings))
    )
  }

  def updateDataSetNameForAllOfTask(task: Task, dataSetName: String)(implicit ctx: DBAccessContext) = {
    update(
      Json.obj("_task" -> task.id),
      Json.obj("$set" -> dataSetName)
    )
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
