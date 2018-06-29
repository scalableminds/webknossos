/*
 * Copyright (C) 2011-2018 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.annotation

import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.tracings.{TracingReference, TracingType}
import com.scalableminds.webknossos.schema.Tables._
import models.annotation.AnnotationState._
import models.annotation.AnnotationTypeSQL.AnnotationTypeSQL
import models.binary.{DataSet, DataSetDAO}
import models.task.{TaskSQLDAO, TaskTypeSQLDAO, _}
import models.user.{User, UserService}
import org.joda.time.format.DateTimeFormat
import play.api.Play.current
import play.api.i18n.Messages
import play.api.i18n.Messages.Implicits._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import slick.jdbc.GetResult._
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.TransactionIsolation.Serializable
import slick.lifted.Rep
import utils.{ObjectId, SQLDAO}


case class AnnotationSQL(
                          _id: ObjectId,
                          _dataSet: ObjectId,
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
                        ) extends FoxImplicits {

  lazy val muta = new AnnotationMutations(this)

  lazy val id = _id.toString
  lazy val team = _team.toString

  def user: Fox[User] =
    UserService.findOneById(_user.toString, useCache = true)(GlobalAccessContext)

  def task: Fox[TaskSQL] =
    _task.toFox.flatMap(taskId => TaskSQLDAO.findOne(taskId)(GlobalAccessContext))

  def dataSet: Fox[DataSet] =
    DataSetDAO.findOneById(_dataSet)(GlobalAccessContext) ?~> "dataSet.notFound"

  val tracingType = tracing.typ

  def isRevertPossible: Boolean = {
    // Unfortunately, we can not revert all tracings, because we do not have the history for all of them
    // hence we need a way to decide if a tracing can safely be reverted. We will use the created date of the
    // annotation to do so
    created > 1470002400000L  // 1.8.2016, 00:00:00
  }

  private def findSettings(implicit ctx: DBAccessContext) = {
    if (typ == AnnotationTypeSQL.Task || typ == AnnotationTypeSQL.TracingBase)
      for {
        taskId <- _task.toFox
        task: TaskSQL <- TaskSQLDAO.findOne(taskId) ?~> Messages("task.notFound")
        taskType <- TaskTypeSQLDAO.findOne(task._taskType) ?~> Messages("taskType.notFound")
      } yield {
        taskType.settings
      }
    else
      Fox.successful(AnnotationSettings.defaultFor(tracing.typ))
  }

  private def composeRestrictions(restrictions: Option[AnnotationRestrictions], readOnly: Option[Boolean]) = {
    if (readOnly.getOrElse(false))
      AnnotationRestrictions.readonlyAnnotation()
    else
      restrictions.getOrElse(AnnotationRestrictions.defaultAnnotationRestrictions(this))
  }

  def publicWrites(requestingUser: Option[User] = None, restrictions: Option[AnnotationRestrictions] = None, readOnly: Option[Boolean] = None)(implicit ctx: DBAccessContext): Fox[JsObject] = {
    for {
      taskJson <- task.flatMap(_.publicWrites).getOrElse(JsNull)
      dataSet <- dataSet
      userJson <- user.map(u => User.userCompactWrites.writes(u)).getOrElse(JsNull)
      settings <- findSettings
      annotationRestrictions <- AnnotationRestrictions.writeAsJson(composeRestrictions(restrictions, readOnly), requestingUser)
    } yield {
      Json.obj(
        "modified" -> DateTimeFormat.forPattern("yyyy-MM-dd HH:mm").print(modified),
        "state" -> state,
        "id" -> id,
        "name" -> name,
        "description" -> description,
        "typ" -> typ,
        "task" -> taskJson,
        "stats" -> statistics,
        "restrictions" -> annotationRestrictions,
        "formattedHash" -> Formatter.formatHash(id),
        "content" -> tracing,
        "dataSetName" -> dataSet.name,
        "dataStore" -> dataSet.dataStoreInfo,
        "isPublic" -> isPublic,
        "settings" -> settings,
        "tracingTime" -> tracingTime,
        "tags" -> (tags ++ Set(dataSet.name, tracing.typ.toString)),
        "user" -> userJson
      )
    }
  }
}


object AnnotationSQL extends FoxImplicits {

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

  def findAllFor(userId: ObjectId, isFinished: Option[Boolean], annotationType: AnnotationTypeSQL, limit: Int)(implicit ctx: DBAccessContext): Fox[List[AnnotationSQL]] = {
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

  // hint: does not use access query (because they dont support prefixes yet). use only after separate access check
  def findAllFinishedForProject(projectId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[AnnotationSQL]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"""select #${columnsWithPrefix("a.")} from #${existingCollectionName} a
                     join webknossos.tasks_ t on a._task = t._id
                     where t._project = ${projectId.id} and a.typ = '#${AnnotationTypeSQL.Task.toString}' and a.state = '#${AnnotationState.Finished.toString}'""".as[AnnotationsRow])
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
               values(${a._id.id}, ${a._dataSet.id}, ${a._task.map(_.id)}, ${a._team.id}, ${a._user.id}, ${a.tracing.id},
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
               _dataSet = ${a._dataSet.id},
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

  def deleteOldInitializingAnnotations: Fox[Unit] = {
    for {
      _ <- run(sqlu"delete from webknossos.annotations where state = '#${AnnotationState.Initializing.toString}' and created < (now() - interval '1 hour')")
    } yield ()
  }

  def logTime(id: ObjectId, time: Long)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id) ?~> "FAILED: AnnotationSQLDAO.assertUpdateAccess"
      _ <- run(sqlu"update webknossos.annotations set tracingTime = Coalesce(tracingTime, 0) + $time where _id = ${id.id}") ?~> "FAILED: run in AnnotationSQLDAO.logTime"
    } yield ()

  def updateState(id: ObjectId, state: AnnotationState)(implicit ctx: DBAccessContext) =
    for {
      _ <- assertUpdateAccess(id) ?~> "FAILED: AnnotationSQLDAO.assertUpdateAccess"
      _ <- run(sqlu"update webknossos.annotations set state = '#${state}' where _id = ${id.id}".withTransactionIsolation(Serializable),
              retryCount = 50, retryIfErrorContains = List(transactionSerializationError)) ?~> "FAILED: run in AnnotationSQLDAO.updateState"
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
