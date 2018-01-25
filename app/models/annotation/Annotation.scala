/*
 * Copyright (C) 2011-2018 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.annotation

import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.reactivemongo.AccessRestrictions.{AllowIf, DenyEveryone}
import com.scalableminds.util.reactivemongo.{DBAccessContext, DefaultAccessDefinitions, GlobalAccessContext, MongoHelpers}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.tracings.{TracingReference, TracingType}
import com.scalableminds.webknossos.schema.Tables._
import models.annotation.AnnotationState._
import models.annotation.AnnotationType.AnnotationType
import models.annotation.AnnotationTypeSQL.AnnotationTypeSQL
import models.basics.SecuredBaseDAO
import models.binary.{DataSetDAO, DataSetSQLDAO}
import models.task.{TaskDAO, TaskSQLDAO, TaskTypeSQLDAO, _}
import models.team.TeamSQLDAO
import models.user.{User, UserService}
import org.joda.time.format.DateTimeFormat
import play.api.Play.current
import play.api.i18n.Messages
import play.api.i18n.Messages.Implicits._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import reactivemongo.api.indexes.{Index, IndexType}
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLDAO}


case class AnnotationSQL(
                          _id: ObjectId,
                          _dataset: ObjectId,
                          _task: Option[ObjectId] = None,
                          _team: ObjectId,
                          _user: ObjectId,
                          tracing: TracingReference,

                          description: String = "",
                          isPublic: Boolean = false,
                          name: String = "",
                          state: AnnotationState.Value = Active,
                          statistics: JsObject = Json.obj(),
                          tags: Set[String] = Set.empty,
                          tracingTime: Option[Long] = None,
                          typ: AnnotationTypeSQL.Value = AnnotationTypeSQL.Explorational,

                          created: Long = System.currentTimeMillis,
                          modified: Long = System.currentTimeMillis,
                          isDeleted: Boolean = false
                        )


object AnnotationSQL extends FoxImplicits {
  implicit val jsonFormat = Json.format[AnnotationSQL]

  //note that annotation settings are dropped here, because on reading, they will be reconstructed from the db relations directly
  def fromAnnotation(a: Annotation)(implicit ctx: DBAccessContext): Fox[AnnotationSQL] = {
    for {
      dataSet <- DataSetSQLDAO.findOneByName(a.dataSetName) ?~> Messages("dataSet.notFound")
      team <- TeamSQLDAO.findOneByName(a.team) ?~> Messages("team.notFound")
      typ <- AnnotationTypeSQL.fromString(a.typ)
    } yield {
      AnnotationSQL(
        ObjectId.fromBson(a._id),
        dataSet._id,
        a._task.map(ObjectId.fromBson),
        team._id,
        ObjectId.fromBson(a._user),
        a.tracingReference,
        a.description,
        a.isPublic,
        a.name,
        a.state,
        a.statistics.getOrElse(Json.obj()),
        a.tags,
        a.tracingTime,
        typ,
        a.createdTimestamp,
        a.modifiedTimestamp,
        !a.isActive
      )
    }
  }
}

object AnnotationSQLDAO extends SQLDAO[AnnotationSQL, AnnotationsRow, Annotations] {
  val collection = Annotations

  def idColumn(x: Annotations): Rep[String] = x._Id
  def isDeletedColumn(x: Annotations): Rep[Boolean] = x.isdeleted

  def parse(r: AnnotationsRow): Fox[AnnotationSQL] =
    for {
      state <- AnnotationState.fromString(r.state).toFox
      tracingTyp <- TracingType.fromString(r.tracingTyp).toFox
      typ <- AnnotationTypeSQL.fromString(r.typ).toFox
    } yield {
      AnnotationSQL(
        ObjectId(r._Id),
        ObjectId(r._Dataset),
        r._Task.map(ObjectId(_)),
        ObjectId(r._Team),
        ObjectId(r._User),
        TracingReference(r.tracingId.toString, tracingTyp),
        r.description,
        r.ispublic,
        r.name,
        state,
        Json.parse(r.statistics).as[JsObject],
        parseArrayTuple(r.tags).toSet,
        r.tracingtime,
        typ,
        r.created.getTime,
        r.modified.getTime,
        r.isdeleted
      )
    }

  // read operations

  def findFor(_user: ObjectId, isFinished: Option[Boolean], annotationType: AnnotationType, limit: Int)(implicit ctx: DBAccessContext): Fox[List[AnnotationSQL]] = {
    def stateQuery(r: Annotations) = isFinished match {
      case Some(true) => r.state === AnnotationState.Finished.toString
      case Some(false) => r.state === AnnotationState.Active.toString
      case None => r.state =!= AnnotationState.Cancelled.toString
    }
    for {
      r <- db.run(Annotations.filter(r => notdel(r) && r._User === _user.id && stateQuery(r) && r.typ === annotationType.toString).take(limit).sortBy(_._Id.desc).result)
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed
  }

  def findActiveAnnotationsFor(userId: ObjectId, typ: AnnotationTypeSQL)(implicit ctx: DBAccessContext): Fox[List[AnnotationSQL]] =
    for {
      r <- db.run(Annotations.filter(r => notdel(r) && r._User === userId.id && r.typ === typ.toString && r.state === AnnotationState.Active.toString).result)
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def findByTaskIdAndType(taskId: ObjectId, typ: AnnotationTypeSQL)(implicit ctx: DBAccessContext): Fox[List[AnnotationSQL]] =
    for {
      r <- db.run(Annotations.filter(r => notdel(r) && r._Task == taskId.id && r.typ === typ.toString && r.state =!= AnnotationState.Cancelled.toString).result)
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed


  // count operations

  def countAll(implicit ctx: DBAccessContext): Fox[Int] =
    for {
      count <- db.run(Annotations.filter(r => notdel(r)).length.result)
    } yield count

  def countActiveAnnotationsFor(userId: ObjectId, typ: AnnotationTypeSQL, excludedTeamNames: List[String])(implicit ctx: DBAccessContext): Fox[Int] =
    for {
      count <- db.run(Annotations.filter(r => (notdel(r) && r._User === userId.id && r.typ === typ.toString && r.state === AnnotationState.Active.toString))
                     .join(Teams).on((_._Team === _._Id)).filterNot(r => r._2.name.inSetBind(excludedTeamNames)).length.result)
    } yield count

  def countByTaskAndUser(taskId: ObjectId, userId: ObjectId, typ: AnnotationTypeSQL)(implicit ctx: DBAccessContext): Fox[Int] =
    for {
      count <- db.run(Annotations.filter(r => notdel(r) && r._Task === taskId.id && r._User === userId.id && r.typ === typ.toString).length.result)
    } yield count


  // write operations

  def insertOne(a: AnnotationSQL): Fox[Unit] = {
    for {
      _ <- db.run(sqlu"""insert into webknossos.annotations(_id, _dataSet, _task, _team, _user, tracing_id, tracing_typ, description, isPublic, name, state, statistics, tags, tracingTime, typ, created, modified, isDeleted)
                       values(${a._id.toString}, ${a._dataset.id}, ${a._task.map(_.id)}, ${a._team.id}, ${a._user.id}, '#${java.util.UUID.fromString(a.tracing.id)}',
                              '#${a.tracing.typ.toString}', ${a.description}, ${a.isPublic}, ${a.name}, '#${a.state.toString}', '#${a.statistics.toString}',
                              '#${writeArrayTuple(a.tags.toList)}', ${a.tracingTime}, '#${a.typ.toString}', ${new java.sql.Timestamp(a.created)},
                              ${new java.sql.Timestamp(a.modified)}, ${a.isDeleted})""")
    } yield ()
  }

  def removeAllWithTaskId(taskId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for {row <- Annotations if (notdel(row) && row._Task === taskId.id)} yield row.isdeleted
    for {_ <- db.run(q.update(true))} yield ()
  }

  def logTime(time: Long, id: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- db.run(sqlu"update webknossos.annotations set tracingTime = tracingTime + $time where _id = ${id.id}")
    } yield ()

  def finish(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for {row <- Annotations if (notdel(row) && row._Id == id.id)} yield row.state
    for {_ <- db.run(q.update(AnnotationState.Finished.toString))} yield ()
  }

  def rename(id: ObjectId, name: String)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for {row <- Annotations if (notdel(row) && row._Id == id.id)} yield row.name
    for {_ <- db.run(q.update(name))} yield ()
  }

}




case class Annotation(
                       _user: BSONObjectID,
                       tracingReference: TracingReference,
                       dataSetName: String,
                       team: String,
                       settings: AnnotationSettings,
                       statistics: Option[JsObject] = None,
                       typ: String = AnnotationType.Explorational,
                       state: AnnotationState.Value = Active,
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
    UserService.findOneById(_user.stringify, useCache = true)(GlobalAccessContext)

  def task: Fox[Task] =
    _task.toFox.flatMap(id => TaskDAO.findOneById(id)(GlobalAccessContext))

  val tracingType = tracingReference.typ

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

object Annotation extends FoxImplicits {
  implicit val annotationFormat = Json.format[Annotation]

  private def findSettingsFor(s: AnnotationSQL)(implicit ctx: DBAccessContext) = {
    if (s.typ == AnnotationTypeSQL.Explorational)
      Fox.successful(AnnotationSettings.defaultFor(s.tracing.typ))
    else
      for {
        taskId <- s._task.toFox
        task: TaskSQL <- TaskSQLDAO.findOne(taskId) ?~> Messages("task.notFound")
        taskType <- TaskTypeSQLDAO.findOne(task._taskType) ?~> Messages("taskType.notFound")
      } yield {
        taskType.settings
      }
  }

  def fromAnnotationsSQL(s: Seq[AnnotationSQL])(implicit ctx: DBAccessContext): Fox[List[Annotation]] =
    Fox.combined(s.map(Annotation.fromAnnotationSQL(_)).toList)


  def fromAnnotationSQL(s: AnnotationSQL)(implicit ctx: DBAccessContext): Fox[Annotation] = {
    for {
      dataset <- DataSetSQLDAO.findOne(s._dataset) ?~> Messages("dataSet.notFound")
      team <- TeamSQLDAO.findOne(s._team) ?~> Messages("team.notFound")
      settings <- findSettingsFor(s)
      name: Option[String] = if (s.name.isEmpty) None else Some(s.name)
      idBson <- s._id.toBSONObjectId.toFox ?~> Messages("sql.invalidBSONObjectId", s._id.toString)
      userIdBson <- s._user.toBSONObjectId.toFox ?~> Messages("sql.invalidBSONObjectId", s._user.toString)
    } yield {
      Annotation(
        userIdBson,
        s.tracing,
        dataset.name,
        team.name,
        settings,
        Some(s.statistics),
        s.typ.toString,
        s.state,
        name,
        s.description,
        s.tracingTime,
        s.created,
        s.modified,
        s._task.map(_.toBSONObjectId).flatten,
        idBson,
        !s.isDeleted,
        s.isPublic,
        s.tags
      )
    }
  }
}


object AnnotationDAO extends SecuredBaseDAO[Annotation]
  with FoxImplicits
  with MongoHelpers {

  val collectionName = "annotations"

  val formatter = Annotation.annotationFormat

  underlying.indexesManager.ensure(Index(Seq("isActive" -> IndexType.Ascending, "_user" -> IndexType.Ascending)))
  underlying.indexesManager.ensure(Index(Seq("isActive" -> IndexType.Ascending, "_task" -> IndexType.Ascending)))
  underlying.indexesManager.ensure(Index(Seq("isActive" -> IndexType.Ascending, "_user" -> IndexType.Ascending, "_task" -> IndexType.Ascending)))
  underlying.indexesManager.ensure(Index(Seq("tracingReference.id" -> IndexType.Ascending)))
  underlying.indexesManager.ensure(Index(Seq("_task" -> IndexType.Ascending, "typ" -> IndexType.Ascending)))

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

  override def findOneById(id: String)(implicit ctx: DBAccessContext): Fox[Annotation] = {
    for {
      annotationSQL <- AnnotationSQLDAO.findOne(ObjectId(id))
      parsed <- Annotation.fromAnnotationSQL(annotationSQL)
    } yield parsed
  }

  def saveToDB(annotation: Annotation)(implicit ctx: DBAccessContext): Fox[Annotation] = {
    for {
      annotationSQL <- AnnotationSQL.fromAnnotation(annotation)
      _ <- AnnotationSQLDAO.insertOne(annotationSQL)
    } yield annotation
  }


  def findFor(_user: BSONObjectID, isFinished: Option[Boolean], annotationType: AnnotationType, limit: Int)(implicit ctx: DBAccessContext) =
    for {
      annotationsSQL: Seq[AnnotationSQL] <- AnnotationSQLDAO.findFor(ObjectId.fromBson(_user), isFinished, annotationType, limit)
      annotations <- Annotation.fromAnnotationsSQL(annotationsSQL)
    } yield {
      annotations
    }

  def logTime(time: Long, _annotation: BSONObjectID)(implicit ctx: DBAccessContext) =
    AnnotationSQLDAO.logTime(time, ObjectId.fromBson(_annotation))

  def findActiveAnnotationsFor(_user: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) =
    for {
      typ <- AnnotationTypeSQL.fromString(annotationType).toFox
      annotationsSQL <- AnnotationSQLDAO.findActiveAnnotationsFor(ObjectId.fromBson(_user), typ)
      annotations <- Fox.combined(annotationsSQL.map(Annotation.fromAnnotationSQL(_)))
    } yield annotations

  def countActiveAnnotations(_user: BSONObjectID, annotationType: AnnotationType, excludeTeams: List[String] = Nil)(implicit ctx: DBAccessContext) =
    for {
      typ <- AnnotationTypeSQL.fromString(annotationType).toFox
      count <- AnnotationSQLDAO.countActiveAnnotationsFor(ObjectId.fromBson(_user), typ, excludeTeams)
    } yield count

  def removeAllWithTaskId(_task: BSONObjectID)(implicit ctx: DBAccessContext) =
    AnnotationSQLDAO.removeAllWithTaskId(ObjectId.fromBson(_task))

  def countByTaskIdAndUser(_user: BSONObjectID, _task: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) =
    for {
      typ <- AnnotationTypeSQL.fromString(annotationType).toFox
      count <- AnnotationSQLDAO.countByTaskAndUser(ObjectId.fromBson(_user), ObjectId.fromBson(_task), typ)
    } yield count

  def findByTaskIdAndType(_task: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) =
    for {
      typ <- AnnotationTypeSQL.fromString(annotationType).toFox
      annotationsSQL <- AnnotationSQLDAO.findByTaskIdAndType(ObjectId.fromBson(_task), typ)
      annotations <- Fox.combined(annotationsSQL.map(Annotation.fromAnnotationSQL(_)))
    } yield annotations

  def findAllUnfinishedByTaskIds(taskIds: List[BSONObjectID])(implicit ctx: DBAccessContext) = {
    find(Json.obj(
      "_task" -> Json.obj("$in" -> Json.toJson(taskIds)),
      "state" -> Json.obj("$ne" -> AnnotationState.Finished)
    )).cursor[Annotation]().collect[List]()
  }

  def findByTracingId(tracingId: String)(implicit ctx: DBAccessContext): Fox[Annotation] = {
    findOne(Json.obj(
      "tracingReference.id" -> tracingId
      )
    )
  }

  def countActiveByTaskIdsAndType(_tasks: List[BSONObjectID], annotationType: AnnotationType)(implicit ctx: DBAccessContext) =
    count(Json.obj(
      "_task" -> Json.obj("$in" -> _tasks),
      "typ" -> annotationType,
      "state" -> AnnotationState.Active))

  def countFinishedByTaskIdsAndType(_tasks: List[BSONObjectID], annotationType: AnnotationType)(implicit ctx: DBAccessContext) =
    count(Json.obj(
      "_task" -> Json.obj("$in" -> _tasks),
      "typ" -> annotationType,
      "state" -> AnnotationState.Finished))

  def countFinishedByTaskIdsAndUserIdAndType(_tasks: List[BSONObjectID], userId: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) =
      count(Json.obj(
        "_user" -> userId,
        "_task" -> Json.obj("$in" -> _tasks),
        "typ" -> annotationType,
        "state" -> AnnotationState.Finished
      ))


  def countRecentlyModifiedByTaskIdsAndType(_tasks: List[BSONObjectID], annotationType: AnnotationType, minimumTimestamp: Long)(implicit ctx: DBAccessContext) =
    count(Json.obj(
      "_task" -> Json.obj("$in" -> _tasks),
      "typ" -> annotationType,
      "modifiedTimestamp" -> Json.obj("$gt" -> minimumTimestamp)
    ))

  def cancelAnnotationsOfUser(_user: BSONObjectID)(implicit ctx: DBAccessContext) =
    update(
      Json.obj(
        "_user" -> _user,
        "typ" -> Json.obj("$in" -> AnnotationType.UserTracings)),
      Json.obj(
        "$set" -> Json.obj(
          "state" -> Cancelled)))

  def updateState(annotation: Annotation, state: AnnotationState.Value)(implicit ctx: DBAccessContext) =
    update(
      Json.obj("_id" -> annotation._id),
      Json.obj("$set" -> Json.obj("state" -> state)))

  //no longer necessary since settings are constructed on read from sql
  def updateSettingsForAllOfTask(task: Task, settings: AnnotationSettings)(implicit ctx: DBAccessContext) = Fox.successful(())

  def countAll(implicit ctx: DBAccessContext) =
    AnnotationSQLDAO.countAll

  def finish(_annotation: BSONObjectID)(implicit ctx: DBAccessContext) =
    for {
      _ <- AnnotationSQLDAO.finish(ObjectId.fromBson(_annotation))
      annotation <- findOneById(_annotation)
    } yield annotation

  def rename(_annotation: BSONObjectID, name: String)(implicit ctx: DBAccessContext) =
    for {
      _ <- AnnotationSQLDAO.rename(ObjectId.fromBson(_annotation), name)
      annotation <- findOneById(_annotation)
    } yield annotation

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

  def updateState(_annotation: BSONObjectID, state: AnnotationState.Value)(implicit ctx: DBAccessContext) =
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
}
