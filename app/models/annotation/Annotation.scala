/*
 * Copyright (C) 2011-2018 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.annotation

import javax.management.relation.Role

import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.tracings.{TracingReference, TracingType}
import com.scalableminds.webknossos.schema.Tables._
import models.annotation.AnnotationState._
import models.annotation.AnnotationType.AnnotationType
import models.annotation.AnnotationTypeSQL.AnnotationTypeSQL
import models.binary.{DataSetDAO, DataSetSQLDAO}
import models.task.TaskSQLDAO.transactionSerializationError
import models.task.{TaskDAO, TaskSQLDAO, TaskTypeSQLDAO, _}
import models.team.TeamSQLDAO
import models.user.{User, UserService}
import net.liftweb.common.Full
import org.joda.time.format.DateTimeFormat
import play.api.Play.current
import play.api.i18n.Messages
import play.api.i18n.Messages.Implicits._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._
import slick.jdbc.GetResult._
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.TransactionIsolation.Serializable
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
      dataSet <- DataSetSQLDAO.findOneByName(a.dataSetName)(GlobalAccessContext) ?~> Messages("dataSet.notFound")
      typ <- AnnotationTypeSQL.fromString(a.typ)
    } yield {
      AnnotationSQL(
        ObjectId.fromBsonId(a._id),
        dataSet._id,
        a._task.map(ObjectId.fromBsonId),
        ObjectId.fromBsonId(a._team),
        ObjectId.fromBsonId(a._user),
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
        TracingReference(r.tracingId, tracingTyp),
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

  override def anonymousReadAccessQ(sharingToken: Option[String]) = s"isPublic"
  override def readAccessQ(requestingUserId: ObjectId) =
    s"""(isPublic or _team in (select _team from webknossos.user_team_roles where _user = '${requestingUserId.id}') or _user = '${requestingUserId.id}'
       or (select _organization from webknossos.teams where webknossos.teams._id = _team)
        in (select _organization from webknossos.users_ where _id = '${requestingUserId.id}' and isAdmin))"""
  override def deleteAccessQ(requestingUserId: ObjectId) =
    s"""(_team in (select _team from webknossos.user_team_roles where isTeamManager and _user = '${requestingUserId.id}') or _user = '${requestingUserId.id}
       or (select _organization from webknossos.teams where webknossos.teams._id = _team)
        in (select _organization from webknossos.users_ where _id = '${requestingUserId.id}' and isAdmin))"""

  // read operations

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[AnnotationSQL] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(sql"select #${columns} from #${existingCollectionName} where _id = ${id.id} and #${accessQuery}".as[AnnotationsRow])
      r <- rList.headOption.toFox ?~> ("Could not find object " + id + " in " + collectionName)
      parsed <- parse(r) ?~> ("SQLDAO Error: Could not parse database row for object " + id + " in " + collectionName)
    } yield parsed

  def findAllFor(userId: ObjectId, isFinished: Option[Boolean], annotationType: AnnotationType, limit: Int)(implicit ctx: DBAccessContext): Fox[List[AnnotationSQL]] = {
    val stateQuery = isFinished match {
      case Some(true) => s"state = '${AnnotationState.Finished.toString}'"
      case Some(false) => s"state = '${AnnotationState.Active.toString}'"
      case None => s"state != '${AnnotationState.Cancelled.toString}'"
    }
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"""select #${columns} from #${existingCollectionName}
                     where _user = ${userId.id} and typ = '#${annotationType.toString}' and #${stateQuery} and #${accessQuery}
                     order by _id desc limit ${limit}""".as[AnnotationsRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed
  }

  def findAllActiveForUser(userId: ObjectId, typ: AnnotationTypeSQL)(implicit ctx: DBAccessContext): Fox[List[AnnotationSQL]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"""select #${columns} from #${existingCollectionName}
                     where _user = ${userId.id} and typ = '#${typ.toString}' and state = '#${AnnotationState.Active.toString}' and #${accessQuery}""".as[AnnotationsRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  // hint: does not use access query (because they dont support prefixes yet). use only after separate access check
  def findAllFinishedForProject(projectId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[AnnotationSQL]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"""select #${columnsWithPrefix("a.")} from #${existingCollectionName} a
                     join webknossos.tasks_ t on a._task = t._id
                     where t._project = ${projectId.id} and a.typ = '#${AnnotationType.Task.toString}' and a.state = '#${AnnotationState.Finished.toString}'""".as[AnnotationsRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def findAllByTaskIdAndType(taskId: ObjectId, typ: AnnotationTypeSQL)(implicit ctx: DBAccessContext): Fox[List[AnnotationSQL]] =
    for {
      r <- run(Annotations.filter(r => notdel(r) && r._Task === taskId.id && r.typ === typ.toString && r.state =!= AnnotationState.Cancelled.toString).result)
      accessQuery <- readAccessQuery
      r <- run(sql"""select #${columns} from #${existingCollectionName}
                     where _task = ${taskId.id} and typ = '#${typ.toString}' and state != '#${AnnotationState.Cancelled.toString}' and #${accessQuery}""".as[AnnotationsRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def findOneByTracingId(tracingId: String)(implicit ctx: DBAccessContext): Fox[AnnotationSQL] =
    for {
      rList <- run(Annotations.filter(r => notdel(r) && r.tracingId === tracingId).result.headOption)
      accessQuery <- readAccessQuery
      rList <- run(sql"select #${columns} from #${existingCollectionName} where tracing_id = ${tracingId} and #${accessQuery}".as[AnnotationsRow])
      r <- rList.headOption.toFox
      parsed <- parse(r)
    } yield {
      parsed
    }

  // count operations

  def countActiveAnnotationsFor(userId: ObjectId, typ: AnnotationTypeSQL, excludedTeamIds: List[ObjectId])(implicit ctx: DBAccessContext): Fox[Int] =
    for {
      accessQuery <- readAccessQuery
      excludeTeamsQ = if (excludedTeamIds.isEmpty) "true" else s"(not t._id in ${writeStructTupleWithQuotes(excludedTeamIds.map(t => sanitize(t.id)))})"
      countList <- run(sql"""select count(*)
                         from (select a._id from
                                  (select #${columns}
                                   from #${existingCollectionName}
                                   where _user = ${userId.id} and typ = '#${typ.toString}' and state = '#${AnnotationState.Active.toString}' and #${accessQuery}) a
                                  join webknossos.teams t on a._team = t._id where #${excludeTeamsQ}) q
                         """.as[Int])
      count <- countList.headOption
    } yield count

  def countActiveByTask(taskId: ObjectId, typ: AnnotationTypeSQL)(implicit ctx: DBAccessContext): Fox[Int] =
    for {
      accessQuery <- readAccessQuery
      countList <- run(sql"""select count(*) from (select _id from #${existingCollectionName} where _task = ${taskId.id} and typ = '#${typ.toString}' and state = '#${AnnotationState.Active.toString}' and #${accessQuery}) q""".as[Int])
      count <- countList.headOption
    } yield count

  // update operations

  def insertOne(a: AnnotationSQL): Fox[Unit] = {
    for {
      _ <- run(
        sqlu"""
               insert into webknossos.annotations(_id, _dataSet, _task, _team, _user, tracing_id, tracing_typ, description, isPublic, name, state, statistics, tags, tracingTime, typ, created, modified, isDeleted)
               values(${a._id.id}, ${a._dataset.id}, ${a._task.map(_.id)}, ${a._team.id}, ${a._user.id}, ${a.tracing.id},
                   '#${a.tracing.typ.toString}', ${a.description}, ${a.isPublic}, ${a.name}, '#${a.state.toString}', '#${sanitize(a.statistics.toString)}',
                   '#${writeArrayTuple(a.tags.toList.map(sanitize(_)))}', ${a.tracingTime}, '#${a.typ.toString}', ${new java.sql.Timestamp(a.created)},
                   ${new java.sql.Timestamp(a.modified)}, ${a.isDeleted})
               """)
    } yield ()
  }

  def updateInitialized(a: AnnotationSQL): Fox[Unit] = {
    for {
      _ <- run(
        sqlu"""
             update webknossos.annotations
             set
               _dataSet = ${a._dataset.id},
               _team = ${a._team.id},
               _user = ${a._user.id},
               tracing_id = ${a.tracing.id},
               tracing_typ = '#${a.tracing.typ.toString}',
               description = ${a.description},
               isPublic = ${a.isPublic},
               name = ${a.name},
               state = '#${a.state.toString}',
               statistics = '#${sanitize(a.statistics.toString)}',
               tags = '#${writeArrayTuple(a.tags.toList.map(sanitize(_)))}',
               tracingTime = ${a.tracingTime},
               typ = '#${a.typ.toString}',
               created = ${new java.sql.Timestamp(a.created)},
               modified = ${new java.sql.Timestamp(a.modified)},
               isDeleted = ${a.isDeleted}
             where _id = ${a._id.id}
          """)
    } yield ()
  }

  def abortInitializingAnnotation(id: ObjectId): Fox[Unit] = {
    for {
      _ <- run(sqlu"delete from webknossos.annotations where _id = ${id.id} and state = '#${AnnotationState.Initializing.toString}'".withTransactionIsolation(Serializable),
               retryCount = 50, retryIfErrorContains = List(transactionSerializationError))
    } yield ()
  }

  def logTime(id: ObjectId, time: Long)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(sqlu"update webknossos.annotations set tracingTime = Coalesce(tracingTime, 0) + $time where _id = ${id.id}")
    } yield ()

  def updateState(id: ObjectId, state: AnnotationState)(implicit ctx: DBAccessContext) =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(sqlu"update webknossos.annotations set state = '#${state}' where _id = ${id.id}".withTransactionIsolation(Serializable),
              retryCount = 50, retryIfErrorContains = List(transactionSerializationError))
    } yield ()

  def updateDescription(id: ObjectId, description: String)(implicit ctx: DBAccessContext) =
    updateStringCol(id, _.description, description)

  def updateName(id: ObjectId, name: String)(implicit ctx: DBAccessContext) =
    updateStringCol(id, _.name, name)

  def updateIsPublic(id: ObjectId, isPublic: Boolean)(implicit ctx: DBAccessContext) =
    updateBooleanCol(id, _.ispublic, isPublic)

  def updateTags(id: ObjectId, tags: List[String])(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(sqlu"update webknossos.annotations set tags = '#${writeArrayTuple(tags.map(sanitize(_)))}' where _id = ${id.id}")
    } yield ()

  def updateModified(id: ObjectId, modified: Long)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(sqlu"update webknossos.annotations set modified = ${new java.sql.Timestamp(modified)} where _id = ${id.id}")
    } yield ()

  def updateTracingReference(id: ObjectId, tracing: TracingReference)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(sqlu"update webknossos.annotations set tracing_id = ${tracing.id}, tracing_typ = '#${tracing.typ.toString}' where _id = ${id.id}")
    } yield ()

  def updateStatistics(id: ObjectId, statistics: JsObject)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(sqlu"update webknossos.annotations set statistics = '#${sanitize(statistics.toString)}' where _id = ${id.id}")
    } yield ()

  def updateUser(id: ObjectId, userId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    updateObjectIdCol(id, _._User, userId)
}




case class Annotation(
                       _user: BSONObjectID,
                       tracingReference: TracingReference,
                       dataSetName: String,
                       _team: BSONObjectID,
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
  lazy val team = _team.stringify

  def user: Fox[User] =
    UserService.findOneById(_user.stringify, useCache = true)(GlobalAccessContext)

  def task: Fox[Task] =
    _task.toFox.flatMap(id => TaskDAO.findOneById(id.stringify)(GlobalAccessContext))

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
      dataset <- DataSetSQLDAO.findOne(s._dataset)(GlobalAccessContext) ?~> Messages("dataSet.notFound")
      settings <- findSettingsFor(s)(GlobalAccessContext)
      name: Option[String] = if (s.name.isEmpty) None else Some(s.name)
      idBson <- s._id.toBSONObjectId.toFox ?~> Messages("sql.invalidBSONObjectId", s._id.toString)
      userIdBson <- s._user.toBSONObjectId.toFox ?~> Messages("sql.invalidBSONObjectId", s._user.toString)
      teamIdBson <- s._team.toBSONObjectId.toFox ?~> Messages("sql.invalidBSONObjectId", s._team.toString)
    } yield {
      Annotation(
        userIdBson,
        s.tracing,
        dataset.name,
        teamIdBson,
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


object AnnotationDAO extends FoxImplicits {

  def findOneById(id: BSONObjectID)(implicit ctx: DBAccessContext): Fox[Annotation] = findOneById(id.stringify)

  def findOneById(id: String)(implicit ctx: DBAccessContext): Fox[Annotation] = {
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

  def updateInitialized(annotation: Annotation)(implicit ctx: DBAccessContext): Fox[Annotation] = {
    for {
      annotationSQL <- AnnotationSQL.fromAnnotation(annotation)
      _ <- AnnotationSQLDAO.updateInitialized(annotationSQL)
    } yield annotation
  }

  def findFor(_user: BSONObjectID, isFinished: Option[Boolean], annotationType: AnnotationType, limit: Int)(implicit ctx: DBAccessContext) =
    for {
      annotationsSQL: Seq[AnnotationSQL] <- AnnotationSQLDAO.findAllFor(ObjectId.fromBsonId(_user), isFinished, annotationType, limit)
      annotations <- Annotation.fromAnnotationsSQL(annotationsSQL)
    } yield {
      annotations
    }

  def logTime(time: Long, _annotation: BSONObjectID)(implicit ctx: DBAccessContext) =
    AnnotationSQLDAO.logTime(ObjectId.fromBsonId(_annotation), time)

  def findActiveAnnotationsFor(_user: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) =
    for {
      typ <- AnnotationTypeSQL.fromString(annotationType).toFox
      annotationsSQL <- AnnotationSQLDAO.findAllActiveForUser(ObjectId.fromBsonId(_user), typ)
      annotations <- Fox.combined(annotationsSQL.map(Annotation.fromAnnotationSQL(_)))
    } yield annotations

  def findFinishedForProject(projectId: String)(implicit ctx: DBAccessContext) =
    for {
      annotationsSQL <- AnnotationSQLDAO.findAllFinishedForProject(ObjectId(projectId))
      annotations <- Fox.combined(annotationsSQL.map(Annotation.fromAnnotationSQL(_)))
    } yield annotations

  def countActiveAnnotations(_user: BSONObjectID, annotationType: AnnotationType, excludeTeams: List[BSONObjectID] = Nil)(implicit ctx: DBAccessContext) =
    for {
      typ <- AnnotationTypeSQL.fromString(annotationType).toFox
      count <- AnnotationSQLDAO.countActiveAnnotationsFor(ObjectId.fromBsonId(_user), typ, excludeTeams.map(ObjectId.fromBsonId(_)))
    } yield count

  def findByTaskIdAndType(_task: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) = {
    val fox = for {
      typ <- AnnotationTypeSQL.fromString(annotationType).toFox
      annotationsSQL <- AnnotationSQLDAO.findAllByTaskIdAndType(ObjectId.fromBsonId(_task), typ)
      annotations <- Fox.combined(annotationsSQL.map(Annotation.fromAnnotationSQL(_)))
    } yield annotations

    //expected return type is Future[List] instead of Fox[List]
    for {
      box <- fox.futureBox
    } yield {
      box match {
        case Full(list) => list
        case _ => List()
      }
    }
  }

  def findOneByTracingId(tracingId: String)(implicit ctx: DBAccessContext): Fox[Annotation] =
    for {
      annotationSQL <- AnnotationSQLDAO.findOneByTracingId(tracingId)
      annotation <- Annotation.fromAnnotationSQL(annotationSQL)
    } yield annotation

  def countActiveByTaskIdAndType(_task: BSONObjectID, annotationType: AnnotationType)(implicit ctx: DBAccessContext) =
    for {
      typ <- AnnotationTypeSQL.fromString(annotationType).toFox
      count <- AnnotationSQLDAO.countActiveByTask(ObjectId.fromBsonId(_task), typ)
    } yield count

  def updateState(_annotation: BSONObjectID, state: AnnotationState.Value)(implicit ctx: DBAccessContext) =
    for {
      _ <- AnnotationSQLDAO.updateState(ObjectId.fromBsonId(_annotation), state)
      annotation <- findOneById(_annotation)
    } yield annotation

  def countAll(implicit ctx: DBAccessContext) =
    AnnotationSQLDAO.countAll

  def finish(_annotation: BSONObjectID)(implicit ctx: DBAccessContext) =
    for {
      _ <- AnnotationSQLDAO.updateState(ObjectId.fromBsonId(_annotation), AnnotationState.Finished)
      annotation <- findOneById(_annotation)
    } yield annotation

  def rename(_annotation: BSONObjectID, name: String)(implicit ctx: DBAccessContext) =
    for {
      _ <- AnnotationSQLDAO.updateName(ObjectId.fromBsonId(_annotation), name)
      annotation <- findOneById(_annotation)
    } yield annotation

  def setDescription(_annotation: BSONObjectID, description: String)(implicit ctx: DBAccessContext) =
    for {
      _ <- AnnotationSQLDAO.updateDescription(ObjectId.fromBsonId(_annotation), description)
      annotation <- findOneById(_annotation)
    } yield annotation

  def setIsPublic(_annotation: BSONObjectID, isPublic: Boolean)(implicit ctx: DBAccessContext) =
    for {
      _ <- AnnotationSQLDAO.updateIsPublic(ObjectId.fromBsonId(_annotation), isPublic)
      annotation <- findOneById(_annotation)
    } yield annotation

  def setTags(_annotation: BSONObjectID, tags: List[String])(implicit ctx: DBAccessContext) =
    for {
      _ <- AnnotationSQLDAO.updateTags(ObjectId.fromBsonId(_annotation), tags)
      annotation <- findOneById(_annotation)
    } yield annotation

  def updateModifiedTimestamp(_annotation: BSONObjectID)(implicit ctx: DBAccessContext) =
    for {
      _ <- AnnotationSQLDAO.updateModified(ObjectId.fromBsonId(_annotation), System.currentTimeMillis)
      annotation <- findOneById(_annotation)
    } yield annotation

  def updateTracingRefernce(_annotation: BSONObjectID, tracingReference: TracingReference)(implicit ctx: DBAccessContext) =
    for {
      _ <- AnnotationSQLDAO.updateTracingReference(ObjectId.fromBsonId(_annotation), tracingReference)
      annotation <- findOneById(_annotation)
    } yield annotation

  def updateStatistics(_annotation: BSONObjectID, statistics: JsObject)(implicit ctx: DBAccessContext) =
    for {
      _ <- AnnotationSQLDAO.updateStatistics(ObjectId.fromBsonId(_annotation), statistics)
      annotation <- findOneById(_annotation)
    } yield annotation

  def transfer(_annotation: BSONObjectID, _user: BSONObjectID)(implicit ctx: DBAccessContext) =
    for {
      _ <- AnnotationSQLDAO.updateUser(ObjectId.fromBsonId(_annotation), ObjectId.fromBsonId(_user))
      annotation <- findOneById(_annotation)
    } yield annotation

}
