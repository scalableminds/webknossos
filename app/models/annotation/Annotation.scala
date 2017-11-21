package models.annotation

import com.scalableminds.braingames.datastore.tracings.TracingReference
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.reactivemongo.AccessRestrictions.{AllowIf, DenyEveryone}
import com.scalableminds.util.reactivemongo.{DBAccessContext, DefaultAccessDefinitions, GlobalAccessContext, MongoHelpers}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.AnnotationType._
import models.basics._
import models.binary.DataSetDAO
import models.task.{Task, TaskDAO}
import models.user.{User, UserService}
import org.joda.time.format.DateTimeFormat
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import reactivemongo.api.indexes.{Index, IndexType}
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._

case class Annotation(
                       _user: Option[BSONObjectID],
                       tracingReference: TracingReference,
                       dataSetName: String,
                       team: String,
                       settings: AnnotationSettings,
                       statistics: Option[JsObject] = None,
                       typ: String = AnnotationType.Explorational,
                       state: AnnotationState = AnnotationState.InProgress,
                       _name: Option[String] = None,
                       description: String = "",
                       tracingTime: Option[Long] = None,
                       createdTimestamp: Long = System.currentTimeMillis,
                       modifiedTimestamp: Long = System.currentTimeMillis,
                       _task: Option[BSONObjectID] = None,
                       _id: BSONObjectID = BSONObjectID.generate,
                       isActive: Boolean = true,
                       isPublic: Boolean = false,
                       tags: Set[String] = Set.empty
                     ) extends FoxImplicits {

  lazy val muta = new AnnotationMutations(this)

  /**
   * Easy access methods
   */

  val name = _name getOrElse ""

  lazy val id = _id.stringify

  def user: Fox[User] =
    _user.toFox.flatMap(u => UserService.findOneById(u.stringify, useCache = true)(GlobalAccessContext))

  def task: Fox[Task] =
    _task.toFox.flatMap(id => TaskDAO.findOneById(id)(GlobalAccessContext))

  val tracingType = tracingReference.typ

  def removeTask() = {
    this.copy(_task = None, typ = AnnotationType.Orphan)
  }

  def saveToDB(implicit ctx: DBAccessContext): Fox[Annotation] = {
    AnnotationDAO.saveToDB(this)
  }

  def isRevertPossible: Boolean = {
    // Unfortunately, we can not revert all tracings, because we do not have the history for all of them
    // hence we need a way to decide if a tracing can safely be reverted. We will use the created date of the
    // annotation to do so
    createdTimestamp > 1470002400000L  // 1.8.2016, 00:00:00
  }

  def toJson(requestingUser: Option[User] = None, restrictions: Option[AnnotationRestrictions] = None, readOnly: Option[Boolean] = None)(implicit ctx: DBAccessContext): Fox[JsObject] = {
    for {
      taskJson <- task.flatMap(t => Task.transformToJson(t)).getOrElse(JsNull)
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> "Could not find DataSet for Annotation"
      userJson <- user.map(u => User.userCompactWrites.writes(u)).getOrElse(JsNull)
    } yield {
      Json.obj(
        "modified" -> DateTimeFormat.forPattern("yyyy-MM-dd HH:mm").print(modifiedTimestamp),
        "state" -> state,
        "id" -> id,
        "name" -> name,
        "description" -> description,
        "typ" -> typ,
        "task" -> taskJson,
        "stats" -> statistics,
        "restrictions" -> AnnotationRestrictions.writeAsJson(composeRestrictions(restrictions, readOnly), requestingUser),
        "formattedHash" -> Formatter.formatHash(id),
        "content" -> tracingReference,
        "dataSetName" -> dataSetName,
        "dataStore" -> dataSet.dataStoreInfo,
        "isPublic" -> isPublic,
        "settings" -> settings,
        "tracingTime" -> tracingTime,
        "tags" -> (tags ++ Set(dataSetName, tracingReference.typ.toString)),
        "user" -> userJson
      )
    }
  }

  private def composeRestrictions(restrictions: Option[AnnotationRestrictions], readOnly: Option[Boolean]) = {
    if (readOnly.getOrElse(false))
      AnnotationRestrictions.readonlyAnnotation()
    else
      restrictions.getOrElse(AnnotationRestrictions.defaultAnnotationRestrictions(this))
  }
}

object Annotation  {
  implicit val annotationFormat = Json.format[Annotation]
}

object AnnotationDAO extends SecuredBaseDAO[Annotation]
  with FoxImplicits
  with MongoHelpers
  with QuerySupportedDAO[Annotation] {

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
          AllowIf(Json.obj("isPublic" -> true))
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

  def saveToDB(annotation: Annotation)(implicit ctx: DBAccessContext): Fox[Annotation] = {
    update(
      Json.obj("_id" -> annotation._id),
      Json.obj(
        "$set" -> formatWithoutId(annotation),
        "$setOnInsert" -> Json.obj("_id" -> annotation._id)
      ),
      upsert = true).map { _ =>
      annotation
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

  def countOpenAnnotations(_user: BSONObjectID, annotationType: AnnotationType, excludeTeams: List[String] = Nil)(implicit ctx: DBAccessContext) =
    count(defaultFindForUserQ(_user, annotationType) ++ Json.obj("team" -> Json.obj("$nin" -> excludeTeams)))

  def removeAllWithTaskId(_task: BSONObjectID)(implicit ctx: DBAccessContext) =
    update(Json.obj("isActive" -> true, "_task" -> _task), Json.obj("$set" -> Json.obj("isActive" -> false)), upsert = false, multi = true)

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

  def findAllUnfinishedByTaskIds(taskIds: List[BSONObjectID])(implicit ctx: DBAccessContext) = {
    find(Json.obj(
      "_task" -> Json.obj("$in" -> Json.toJson(taskIds)),
      "state.isFinished" -> false
    )).cursor[Annotation]().collect[List]()
  }

  def findByTracingId(tracingId: String)(implicit ctx: DBAccessContext): Fox[Annotation] = {
    findOne(Json.obj(
      "tracingReference.id" -> tracingId
      )
    )
  }

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

  def countAll(implicit ctx: DBAccessContext) =
    count(Json.obj("isActive" -> true))

  def finish(_annotation: BSONObjectID)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _annotation),
      Json.obj("$set" -> Json.obj("state" -> AnnotationState.Finished)),
      returnNew = true)

  def rename(_annotation: BSONObjectID, name: String)(implicit ctx: DBAccessContext) =
    if (name == "") {
      findAndModify(
        Json.obj("_id" -> _annotation),
        Json.obj("$unset" -> Json.obj("_name" -> 1)),
        returnNew = true)
    } else {
      findAndModify(
        Json.obj("_id" -> _annotation),
        Json.obj("$set" -> Json.obj("_name" -> name)),
        returnNew = true)
    }

  def setDescription(_annotation: BSONObjectID, description: String)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _annotation),
      Json.obj("$set" -> Json.obj("description" -> description)),
      returnNew = true)

  def setIsPublic(_annotation: BSONObjectID, isPublic: Boolean)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _annotation),
      Json.obj("$set" -> Json.obj("isPublic" -> isPublic)),
      returnNew = true)

  def setTags(_annotation: BSONObjectID, tags: List[String])(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _annotation),
      Json.obj("$set" -> Json.obj("tags" -> tags)),
      returnNew = true)

  def reopen(_annotation: BSONObjectID)(implicit ctx: DBAccessContext) =
    updateState(_annotation, AnnotationState.InProgress)

  def updateState(_annotation: BSONObjectID, state: AnnotationState)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _annotation),
      Json.obj("$set" -> Json.obj("state" -> state)),
      returnNew = true)

  def updateModifiedTimestamp(_annotation: BSONObjectID)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _annotation),
      Json.obj("$set" -> Json.obj("modifiedTimestamp" -> System.currentTimeMillis)),
      returnNew = true)

  def updateTracingRefernce(_annotation: BSONObjectID, tracingReference: TracingReference)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _annotation),
      Json.obj("$set" -> Json.obj(
        "tracingReference" -> tracingReference)),
      returnNew = true)

  def updateStatistics(_annotation: BSONObjectID, statistics: JsObject)(implicit ctx: DBAccessContext) =
    findAndModify(
      Json.obj("_id" -> _annotation),
      Json.obj("$set" -> Json.obj(
        "statistics" -> statistics)),
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
