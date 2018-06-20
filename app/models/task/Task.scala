package models.task

import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.tracings.TracingType
import com.scalableminds.webknossos.schema.Tables._
import models.annotation._
import models.binary.DataSetDAO
import models.project.ProjectSQLDAO
import models.team.TeamSQLDAO
import models.user.{Experience, User}
import org.joda.time.DateTime
import org.joda.time.format.DateTimeFormat
import play.api.Play.current
import play.api.i18n.Messages
import play.api.i18n.Messages.Implicits._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsNull, JsObject, Json}
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.TransactionIsolation.Serializable
import utils.{ObjectId, SQLClient, SQLDAO}

import scala.util.Random


case class TaskSQL(
                    _id: ObjectId,
                    _project: ObjectId,
                    _script: Option[ObjectId],
                    _taskType: ObjectId,
                    neededExperience: Experience,
                    totalInstances: Long,
                    openInstances: Long,
                    tracingTime: Option[Long],
                    boundingBox: Option[BoundingBox],
                    editPosition: Point3D,
                    editRotation: Vector3D,
                    creationInfo: Option[String],
                    created: Long = System.currentTimeMillis(),
                    isDeleted: Boolean = false
                  ) extends FoxImplicits {

  def id = _id.toString

  def annotationBase(implicit ctx: DBAccessContext) =
    AnnotationService.baseFor(_id)

  def taskType(implicit ctx: DBAccessContext) =
    for {
      taskTypeIdBson <- _taskType.toBSONObjectId.toFox
      taskType <- TaskTypeDAO.findOneById(taskTypeIdBson)(GlobalAccessContext)
    } yield taskType

  def project(implicit ctx: DBAccessContext) =
    ProjectSQLDAO.findOne(_project)

  def annotations(implicit ctx: DBAccessContext) =
    AnnotationService.annotationsFor(_id)

  def settings(implicit ctx: DBAccessContext) =
    taskType.map(_.settings) getOrElse AnnotationSettings.defaultFor(TracingType.skeleton)

  def countActive(implicit ctx: DBAccessContext) =
    AnnotationService.countActiveAnnotationsFor(_id).getOrElse(0)

  def status(implicit ctx: DBAccessContext) = {
    for {
      active <- countActive
    } yield CompletionStatus(openInstances, active, totalInstances - (active + openInstances))
  }

  def hasEnoughExperience(user: User) =
    neededExperience.isEmpty || user.experiences.get(neededExperience.domain).exists(_ >= neededExperience.value)



  def publicWrites(implicit ctx: DBAccessContext): Fox[JsObject] =
    for {
      annotationBase <- annotationBase
      dataSet <- DataSetDAO.findOneById(annotationBase._dataSet)
      status <- status.getOrElse(CompletionStatus(-1, -1, -1))
      taskType <- taskType.map(TaskType.transformToJson) getOrElse JsNull
      scriptInfo <- _script.map(_.toBSONObjectId).flatten.toFox.flatMap(sid => ScriptDAO.findOneById(sid)).futureBox
      scriptJs <- scriptInfo.toFox.flatMap(s => Script.scriptPublicWrites(s)).futureBox
      project <- project
      team <- project.team
    } yield {
      Json.obj(
        "id" -> _id.toString,
        "formattedHash" -> Formatter.formatHash(_id.toString),
        "projectName" -> project.name,
        "team" -> team.name,
        "type" -> taskType,
        "dataSet" -> dataSet.name,
        "neededExperience" -> neededExperience,
        "created" -> DateTimeFormat.forPattern("yyyy-MM-dd HH:mm").print(created),
        "status" -> status,
        "script" -> scriptJs.toOption,
        "tracingTime" -> tracingTime,
        "creationInfo" -> creationInfo,
        "boundingBox" -> boundingBox,
        "editPosition" -> editPosition,
        "editRotation" -> editRotation
      )
    }

}

object TaskSQLDAO extends SQLDAO[TaskSQL, TasksRow, Tasks] {
  val collection = Tasks

  def idColumn(x: Tasks) = x._Id
  def isDeletedColumn(x: Tasks) = x.isdeleted

  def parse(r: TasksRow): Fox[TaskSQL] =
    for {
      editPosition <- Point3D.fromList(parseArrayTuple(r.editposition).map(_.toInt)) ?~> "could not parse edit position"
      editRotation <- Vector3D.fromList(parseArrayTuple(r.editrotation).map(_.toDouble)) ?~> "could not parse edit rotation"
    } yield {
      TaskSQL(
        ObjectId(r._Id),
        ObjectId(r._Project),
        r._Script.map(ObjectId(_)),
        ObjectId(r._Tasktype),
        Experience(r.neededexperienceDomain, r.neededexperienceValue),
        r.totalinstances,
        r.openinstances,
        r.tracingtime,
        r.boundingbox.map(b => parseArrayTuple(b).map(_.toInt)).map(BoundingBox.fromSQL).flatten,
        editPosition,
        editRotation,
        r.creationinfo,
        r.created.getTime,
        r.isdeleted
      )
    }

  override def readAccessQ(requestingUserId: ObjectId) =
    s"""((select _team from webknossos.projects p where _project = p._id) in (select _team from webknossos.user_team_roles where _user = '${requestingUserId.id}')
      or ((select _organization from webknossos.teams where webknossos.teams._id = (select _team from webknossos.projects p where _project = p._id))
        in (select _organization from webknossos.users_ where _id = '${requestingUserId.id}' and isAdmin)))"""
  override def deleteAccessQ(requestingUserId: ObjectId) =
    s"""((select _team from webknossos.projects p where _project = p._id) in (select _team from webknossos.user_team_roles where isTeamManager and _user = '${requestingUserId.id}')
      or ((select _organization from webknossos.teams where webknossos.teams._id = (select _team from webknossos.projects p where _project = p._id))
        in (select _organization from webknossos.users_ where _id = '${requestingUserId.id}' and isAdmin)))"""

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[TaskSQL] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(sql"select #${columns} from #${existingCollectionName} where _id = ${id.id} and #${accessQuery}".as[TasksRow])
      r <- rList.headOption.toFox ?~> ("Could not find object " + id + " in " + collectionName)
      parsed <- parse(r) ?~> ("SQLDAO Error: Could not parse database row for object " + id + " in " + collectionName)
    } yield parsed

  override def findAll(implicit ctx: DBAccessContext): Fox[List[TaskSQL]] = {
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select #${columns} from #${existingCollectionName} where #${accessQuery}".as[TasksRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed
  }

  def findAllByTaskType(taskTypeId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[TaskSQL]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select #${columns} from #${existingCollectionName} where _taskType = ${taskTypeId.id} and #${accessQuery}".as[TasksRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def findAllByProject(projectId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[TaskSQL]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select #${columns} from #${existingCollectionName} where _project = ${projectId.id} and #${accessQuery}".as[TasksRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed



  private def findNextTaskQ(userId: ObjectId, teamIds: List[ObjectId]) =
    s"""
        select ${columnsWithPrefix("webknossos.tasks_.")}
           from
             webknossos.tasks_
             join
               (select domain, value
                from webknossos.user_experiences
                where _user = '${userId.id}')
               as user_experiences on webknossos.tasks_.neededExperience_domain = user_experiences.domain and webknossos.tasks_.neededExperience_value <= user_experiences.value
             join webknossos.projects_ on webknossos.tasks_._project = webknossos.projects_._id
             left join (select _task from webknossos.annotations_ where _user = '${userId.id}' and typ = '${AnnotationTypeSQL.Task}') as userAnnotations ON webknossos.tasks_._id = userAnnotations._task
           where webknossos.tasks_.openInstances > 0
                 and webknossos.projects_._team in ${writeStructTupleWithQuotes(teamIds.map(t => sanitize(t.id)))}
                 and userAnnotations._task is null
                 and not webknossos.projects_.paused
           order by webknossos.projects_.priority desc
           limit 1
      """

  def assignNext(userId: ObjectId, teamIds: List[ObjectId])(implicit ctx: DBAccessContext): Fox[(TaskSQL, ObjectId)] = {

    val annotationId = ObjectId.generate
    val dummyTracingId = Random.alphanumeric.take(36).mkString

    val insertAnnotationQ = sqlu"""
           with task as (#${findNextTaskQ(userId, teamIds)}),
           dataset as (select _id from webknossos.datasets_ limit 1)
           insert into webknossos.annotations(_id, _dataSet, _task, _team, _user, tracing_id, tracing_typ, description, isPublic, name, state, statistics, tags, tracingTime, typ, created, modified, isDeleted)
           select ${annotationId.id}, dataset._id, task._id, ${teamIds.headOption.map(_.id).getOrElse("")}, ${userId.id}, ${dummyTracingId},
                    'skeleton', '', false, '', '#${AnnotationState.Initializing.toString}', '{}',
                    '{}', 0, 'Task', ${new java.sql.Timestamp(System.currentTimeMillis)},
                     ${new java.sql.Timestamp(System.currentTimeMillis)}, false
           from task, dataset
      """

    val findTaskOfInsertedAnnotationQ =
      sql"""
           select #${columnsWithPrefix("t.")}
           from webknossos.annotations_ a
           join webknossos.tasks_ t on a._task = t._id
           where a._id = ${annotationId.id}
         """.as[TasksRow]

    for {
      _ <- run(insertAnnotationQ.withTransactionIsolation(Serializable),
               retryCount = 50, retryIfErrorContains = List(transactionSerializationError, "Negative openInstances for Task"))
      rList <- run(findTaskOfInsertedAnnotationQ)
      r <- rList.headOption.toFox
      parsed <- parse(r)
    } yield (parsed, annotationId)
  }

  def peekNextAssignment(userId: ObjectId, teamIds: List[ObjectId])(implicit ctx: DBAccessContext): Fox[TaskSQL] = {
    for {
      rList <- run(sql"#${findNextTaskQ(userId, teamIds)}".as[TasksRow])
      r <- rList.headOption.toFox
      parsed <- parse(r)
    } yield parsed
  }

  def findAllByProjectAndTaskTypeAndIdsAndUser(
                                        projectNameOpt: Option[String],
                                        taskTypeIdOpt: Option[ObjectId],
                                        taskIdsOpt: Option[List[ObjectId]],
                                        userIdOpt: Option[ObjectId]
                                      )(implicit ctx: DBAccessContext): Fox[List[TaskSQL]] = {

    /* WARNING: This code composes an sql query with #${} without sanitize(). Change with care. */

    val projectFilterFox = projectNameOpt match {
      case Some(pName) => for {project <- ProjectSQLDAO.findOneByName(pName)} yield s"(t._project = '${project._id}')"
      case _ => Fox.successful("true")
    }
    val taskTypeFilter = taskTypeIdOpt.map(ttId => s"(t._taskType = '${ttId}')").getOrElse("true")
    val taskIdsFilter = taskIdsOpt.map(tIds => if (tIds.isEmpty) "false" else s"(t._id in ${writeStructTupleWithQuotes(tIds.map(_.toString))})").getOrElse("true")
    val userJoin = userIdOpt.map(_ => "join webknossos.annotations_ a on a._task = t._id join webknossos.users_ u on a._user = u._id").getOrElse("")
    val userFilter = userIdOpt.map(uId => s"(u._id = '${uId}' and a.typ = '${AnnotationTypeSQL.Task}' and a.state != '${AnnotationState.Cancelled}')").getOrElse("true")

    for {
      projectFilter <- projectFilterFox
      accessQuery <- readAccessQuery
      q = sql"""select #${columnsWithPrefix("t.")}
                from webknossos.tasks_ t
                #${userJoin}
                where #${projectFilter}
                and #${taskTypeFilter}
                and #${taskIdsFilter}
                and #${userFilter}
                and #${accessQuery}
                limit 1000"""
      r <- run(q.as[TasksRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed
  }

  def countOpenInstancesForTask(taskId: ObjectId): Fox[Int] = {
    for {
      result <- run(sql"select openInstances from webknossos.tasks_ where _id = ${taskId.toString}".as[Int])
      firstResult <- result.headOption.toFox
    } yield firstResult
  }

  def countAllOpenInstances(implicit ctx: DBAccessContext): Fox[Int] = {
    for {
      result <- run(sql"select sum(openInstances) from webknossos.tasks_".as[Int])
      firstResult <- result.headOption
    } yield firstResult
  }

  def countOpenInstancesForProject(projectId: ObjectId): Fox[Int] = {
    for {
      result <- run(sql"""select sum(openInstances)
                          from webknossos.tasks_
                          where _project = ${projectId.id}
                          group by _project""".as[Int])
      firstResult <- result.headOption
    } yield firstResult
  }

  def countAllOpenInstancesGroupedByProjects(implicit ctx: DBAccessContext): Fox[Map[ObjectId, Int]] = {
    for {
      rowsRaw <- run(
        sql"""select _project, sum(openInstances)
              from webknossos.tasks_
              group by _project
           """.as[(String, Int)])
    } yield {
      rowsRaw.toList.map(r => (ObjectId(r._1), r._2)).toMap
    }
  }

  def insertOne(t: TaskSQL): Fox[Unit] = {
    for {
      _ <- run(
        sqlu"""insert into webknossos.tasks(_id, _project, _script, _taskType, neededExperience_domain, neededExperience_value,
                                             totalInstances, openInstances, tracingTime, boundingBox, editPosition, editRotation, creationInfo, created, isDeleted)
                   values(${t._id.id}, ${t._project.id}, #${optionLiteral(t._script.map(s => sanitize(s.id)))}, ${t._taskType.id},
                          ${t.neededExperience.domain}, ${t.neededExperience.value},
                          ${t.totalInstances}, ${t.totalInstances}, ${t.tracingTime}, #${optionLiteral(t.boundingBox.map(_.toSql.map(_.toString)).map(writeStructTuple(_)))},
                           '#${writeStructTuple(t.editPosition.toList.map(_.toString))}', '#${writeStructTuple(t.editRotation.toList.map(_.toString))}',
                           #${optionLiteral(t.creationInfo.map(sanitize(_)))}, ${new java.sql.Timestamp(t.created)}, ${t.isDeleted})
        """)
    } yield ()
  }

  def updateTotalInstances(id: ObjectId, newTotalInstances: Long)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for { c <- Tasks if c._Id === id.id } yield c.totalinstances
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q.update(newTotalInstances).withTransactionIsolation(Serializable), retryCount = 50, retryIfErrorContains = List(transactionSerializationError))
    } yield ()
  }

  def incrementTotalInstancesOfAllWithProject(projectId: ObjectId, delta: Long)(implicit ctx: DBAccessContext): Fox[Unit] = {
    for {
      accessQuery <- readAccessQuery
      _ <- run(sqlu"update webknossos.tasks set totalInstances = totalInstances + ${delta} where _project = ${projectId.id} and #${accessQuery}".withTransactionIsolation(Serializable),
               retryCount = 50, retryIfErrorContains = List(transactionSerializationError))
    } yield ()
  }

  def removeScriptFromAllTasks(scriptId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] = {
    for {
      _ <- run(sqlu"update webknossos.tasks set _script = null where _script = ${scriptId.id}")
    } yield ()
  }

  def logTime(id: ObjectId, time: Long)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id) ?~> "FAILED: TaskSQLDAO.assertUpdateAccess"
      _ <- run(sqlu"update webknossos.tasks set tracingTime = coalesce(tracingTime, 0) + $time where _id = ${id.id}") ?~> "FAILED: run in TaskSQLDAO.logTime"
    } yield ()

  def removeOneAndItsAnnotations(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val queries = List(
      sqlu"update webknossos.tasks set isDeleted = true where _id = ${id.id}",
      sqlu"update webknossos.annotations set isDeleted = true where _task = ${id.id}"
    )
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(DBIO.sequence(queries).transactionally)
    } yield ()
  }

  def removeAllWithTaskTypeAndItsAnnotations(taskTypeId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val queries = List(
      sqlu"update webknossos.tasks set isDeleted = true where _taskType = ${taskTypeId.id}",
      sqlu"update webknossos.annotations set isDeleted = true where _task in (select _id from webknossos.tasks where _taskType = ${taskTypeId.id})"
    )
    for {
      _ <- run(DBIO.sequence(queries).transactionally)
    } yield ()
  }

  def removeAllWithProjectAndItsAnnotations(projectId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val queries = List(
      sqlu"update webknossos.tasks set isDeleted = true where _project = ${projectId.id}",
      sqlu"update webknossos.annotations set isDeleted = true where _task in (select _id from webknossos.tasks where _project = ${projectId.id})"
    )
    for {
      _ <- run(DBIO.sequence(queries).transactionally)
    } yield ()
  }

}

