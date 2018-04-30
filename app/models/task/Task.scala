package models.task

import javax.management.relation.Role

import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.reactivemongo.AccessRestrictions.{AllowIf, DenyEveryone}
import com.scalableminds.util.reactivemongo.{DBAccessContext, DefaultAccessDefinitions, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.tracings.TracingType
import com.scalableminds.webknossos.schema.Tables
import com.scalableminds.webknossos.schema.Tables._
import models.annotation._
import models.basics.SecuredBaseDAO
import models.project.{Project, ProjectDAO, ProjectSQLDAO}
import models.team.TeamSQLDAO
import models.user.{Experience, User}
import org.joda.time.DateTime
import org.joda.time.format.DateTimeFormat
import play.api.Play.current
import play.api.i18n.Messages
import play.api.i18n.Messages.Implicits._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsNull, JsObject, Json}
import reactivemongo.api.indexes.IndexType
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._
import slick.jdbc.PostgresProfile
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.TransactionIsolation.Serializable
import utils.{ObjectId, SQLClient, SQLDAO}
import views.html.helper.select

import scala.util.Random


case class TaskSQL(
                    _id: ObjectId,
                    _project: ObjectId,
                    _script: Option[ObjectId],
                    _taskType: ObjectId,
                    _team: ObjectId,
                    neededExperience: Experience,
                    totalInstances: Long,
                    tracingTime: Option[Long],
                    boundingBox: Option[BoundingBox],
                    editPosition: Point3D,
                    editRotation: Vector3D,
                    creationInfo: Option[String],
                    created: Long = System.currentTimeMillis(),
                    isDeleted: Boolean = false
                  )

object TaskSQL {
  def fromTask(t: Task)(implicit ctx: DBAccessContext): Fox[TaskSQL] = {
    for {
      project <- ProjectSQLDAO.findOneByName(t._project)
    } yield {
      TaskSQL(
        ObjectId.fromBsonId(t._id),
        project._id,
        t._script.map(ObjectId(_)),
        ObjectId.fromBsonId(t._taskType),
        ObjectId.fromBsonId(t._team),
        t.neededExperience,
        t.instances,
        t.tracingTime,
        t.boundingBox,
        t.editPosition,
        t.editRotation,
        t.creationInfo,
        t.created.getMillis,
        !t.isActive
      )
    }
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
        ObjectId(r._Team),
        Experience(r.neededexperienceDomain, r.neededexperienceValue),
        r.totalinstances,
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
    s"""(_team in (select _team from webknossos.user_team_roles where _user = '${requestingUserId.id}')
      or ((select _organization from webknossos.teams where webknossos.teams._id = _team)
        in (select _organization from webknossos.users_ where _id = '${requestingUserId.id}' and isAdmin)))"""
  override def deleteAccessQ(requestingUserId: ObjectId) =
    s"""(_team in (select _team from webknossos.user_team_roles where isTeamManager and _user = '${requestingUserId.id}')
      or ((select _organization from webknossos.teams where webknossos.teams._id = _team)
        in (select _organization from webknossos.users_ where _id = '${requestingUserId.id}' and isAdmin)))"""

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[TaskSQL] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(sql"select * from #${existingCollectionName} where _id = ${id.id} and #${accessQuery}".as[TasksRow])
      r <- rList.headOption.toFox ?~> ("Could not find object " + id + " in " + collectionName)
      parsed <- parse(r) ?~> ("SQLDAO Error: Could not parse database row for object " + id + " in " + collectionName)
    } yield parsed

  override def findAll(implicit ctx: DBAccessContext): Fox[List[TaskSQL]] = {
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select * from #${existingCollectionName} where #${accessQuery}".as[TasksRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed
  }

  def findAllByTaskType(taskTypeId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[TaskSQL]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select * from #${existingCollectionName} where _taskType = ${taskTypeId.id} and #${accessQuery}".as[TasksRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def findAllByProject(projectId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[TaskSQL]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select * from #${existingCollectionName} where _project = ${projectId.id} and #${accessQuery}".as[TasksRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed



  private def findNextTaskQ(userId: ObjectId, teamIds: List[ObjectId]) =
    s"""
        select webknossos.tasks_.*
                   from
                     (webknossos.tasks_
                     join webknossos.task_instances on webknossos.tasks_._id = webknossos.task_instances._id)
                     join
                       (select *
                        from webknossos.user_experiences
                        where _user = '${userId.id}')
                       as user_experiences on webknossos.tasks_.neededExperience_domain = user_experiences.domain and webknossos.tasks_.neededExperience_value <= user_experiences.value
                     join webknossos.projects_ on webknossos.tasks_._project = webknossos.projects_._id
                     left join (select _task from webknossos.annotations_ where _user = '${userId.id}' and typ = '${AnnotationType.Task}') as userAnnotations ON webknossos.tasks_._id = userAnnotations._task
                   where webknossos.task_instances.openInstances > 0
                         and webknossos.tasks_._team in ${writeStructTupleWithQuotes(teamIds.map(t => sanitize(t.id)))}
                         and userAnnotations._task is null
                         and not webknossos.projects_.paused
                   order by webknossos.projects_.priority desc
                   limit 1
      """

  def assignNext(userId: ObjectId, teamIds: List[ObjectId])(implicit ctx: DBAccessContext): Fox[(TaskSQL, ObjectId)] = {

    val annotationId = ObjectId.generate
    val dummyTracingId = Random.alphanumeric.take(36).mkString

    val insertAnnotationQ = sqlu"""
           with task as (#${findNextTaskQ(userId, teamIds)})

           insert into webknossos.annotations(_id, _dataSet, _task, _team, _user, tracing_id, tracing_typ, description, isPublic, name, state, statistics, tags, tracingTime, typ, created, modified, isDeleted)
           select ${annotationId.id}, 'dummyDatasetId', _id, 'dummyTeamId', 'dummyUserId', ${dummyTracingId},
                    'skeleton', '', false, '', '#${AnnotationState.Initializing.toString}', '{}',
                    '{}', 0, 'Task', ${new java.sql.Timestamp(System.currentTimeMillis)},
                     ${new java.sql.Timestamp(System.currentTimeMillis)}, false
           from task
      """

    val findTaskOfInsertedAnnotationQ =
      sql"""
           select t.*
           from webknossos.annotations_ a
           join webknossos.tasks_ t on a._task = t._id
           where a._id = ${annotationId.id}
         """.as[TasksRow]

    for {
      _ <- run(insertAnnotationQ.withTransactionIsolation(Serializable), retryTransactionCount = 50)
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

  def findAllByPojectAndTaskTypeAndIds(projectOpt: Option[String], taskTypeOpt: Option[String], idsOpt: Option[List[String]])(implicit ctx: DBAccessContext): Fox[List[TaskSQL]] = {
    /* WARNING: This code composes an sql query with #${} without sanitize(). Change with care. */
    val projectFilterFox = projectOpt match {
      case Some(pName) => for {project <- ProjectSQLDAO.findOneByName(pName)} yield s"(_project = '${sanitize(project._id.toString)}')"
      case _ => Fox.successful("true")
    }
    val taskTypeFilter = taskTypeOpt.map(tId => s"(_taskType = '${sanitize(tId)}')").getOrElse("true")
    val idsFilter = idsOpt.map(ids => if (ids.isEmpty) "false" else s"(_id in ${writeStructTupleWithQuotes(ids.map(sanitize(_)))})").getOrElse("true")

    for {
      projectFilter <- projectFilterFox
      accessQuery <- readAccessQuery
      q = sql"select * from webknossos.tasks where webknossos.tasks.isDeleted = false and #${projectFilter} and #${taskTypeFilter} and #${idsFilter} and #${accessQuery} limit 1000"
      r <- run(q.as[TasksRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed
  }

  def countOpenInstancesForTask(taskId: ObjectId): Fox[Int] = {
    for {
      result <- run(sql"select openInstances from webknossos.task_instances where _id = ${taskId.toString}".as[Int])
      firstResult <- result.headOption.toFox
    } yield firstResult
  }

  def countAllOpenInstances(implicit ctx: DBAccessContext): Fox[Int] = {
    for {
      result <- run(sql"select sum(openInstances) from webknossos.task_instances".as[Int])
      firstResult <- result.headOption
    } yield firstResult
  }

  def countOpenInstancesForProject(projectId: ObjectId): Fox[Int] = {
    for {
      result <- run(sql"""select sum(openInstances)
                          from webknossos.task_instances i join webknossos.tasks t on i._id = t._id
                          where t._project = ${projectId.id}
                          group by t._project""".as[Int])
      firstResult <- result.headOption
    } yield firstResult
  }

  def countAllOpenInstancesGroupedByProjects(implicit ctx: DBAccessContext): Fox[List[(ObjectId, Int)]] = {
    for {
      rowsRaw <- run(
        sql"""select webknossos.tasks_._project, sum(webknossos.task_instances.openInstances)
              from webknossos.tasks_ join webknossos.task_instances on webknossos.tasks_._id = webknossos.task_instances._id
              group by webknossos.tasks_._project
           """.as[(String, Int)])
    } yield {
      rowsRaw.toList.map(r => (ObjectId(r._1), r._2))
    }
  }

  def insertOne(t: TaskSQL): Fox[Unit] = {
    for {
      _ <- run(
        sqlu"""insert into webknossos.tasks(_id, _project, _script, _taskType, _team, neededExperience_domain, neededExperience_value,
                                             totalInstances, tracingTime, boundingBox, editPosition, editRotation, creationInfo, created, isDeleted)
                   values(${t._id.id}, ${t._project.id}, #${optionLiteral(t._script.map(s => sanitize(s.id)))}, ${t._taskType.id}, ${t._team.id},
                          ${t.neededExperience.domain}, ${t.neededExperience.value},
                          ${t.totalInstances}, ${t.tracingTime}, #${optionLiteral(t.boundingBox.map(_.toSql.map(_.toString)).map(writeStructTuple(_)))},
                           '#${writeStructTuple(t.editPosition.toList.map(_.toString))}', '#${writeStructTuple(t.editRotation.toList.map(_.toString))}',
                           #${optionLiteral(t.creationInfo.map(sanitize(_)))}, ${new java.sql.Timestamp(t.created)}, ${t.isDeleted})
        """)
    } yield ()
  }

  def updateTotalInstances(id: ObjectId, newTotalInstances: Long)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for { c <- Tasks if c._Id === id.id } yield c.totalinstances
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q.update(newTotalInstances))
    } yield ()
  }

  def incrementTotalInstancesOfAllWithProject(projectId: ObjectId, delta: Long)(implicit ctx: DBAccessContext): Fox[Unit] = {
    for {
      accessQuery <- readAccessQuery
      _ <- run(sqlu"update webknossos.tasks set totalInstances = totalInstances + ${delta} where _project = ${projectId.id} and #${accessQuery}")
    } yield ()
  }

  def removeScriptFromAllTasks(scriptId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] = {
    for {
      _ <- run(sqlu"update webknossos.tasks set _script = null where _script = ${scriptId.id}")
    } yield ()
  }

  def logTime(id: ObjectId, time: Long)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(sqlu"update webknossos.tasks set tracingTime = coalesce(tracingTime, 0) + $time where _id = ${id.id}")
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






class info(message: String) extends scala.annotation.StaticAnnotation

case class Task(
                 @info("Reference to task type") _taskType: BSONObjectID,
                 @info("Assigned team ObjectID") _team: BSONObjectID,
                 @info("Required experience") neededExperience: Experience = Experience.empty,
                 @info("Number of total instances") instances: Int = 1,
                 @info("Number of open (=remaining) instances") openInstances: Int = 1,
                 @info("Bounding Box (redundant to base tracing)") boundingBox: Option[BoundingBox] = None,
                 @info("Start point edit position (redundant to base tracing)") editPosition: Point3D,
                 @info("Start point edit rotation (redundant to base tracing)") editRotation: Vector3D,
                 @info("Current tracing time") tracingTime: Option[Long] = None,
                 @info("Date of creation") created: DateTime = DateTime.now(),
                 @info("Flag indicating deletion") isActive: Boolean = true,
                 @info("Reference to project") _project: String,
                 @info("Script to be executed on task start") _script: Option[String],
                 @info("Optional information on the tasks creation") creationInfo: Option[String] = None,
                 @info("Priority for users fetching new tasks") priority: Int = 100,
                 @info("Unique ID") _id: BSONObjectID = BSONObjectID.generate
               ) extends FoxImplicits {

  lazy val id = _id.stringify
  lazy val team = _team.stringify

  def taskType(implicit ctx: DBAccessContext) = TaskTypeDAO.findOneById(_taskType)(GlobalAccessContext).toFox

  def project(implicit ctx: DBAccessContext) =
    ProjectDAO.findOneByName(_project)

  def annotations(implicit ctx: DBAccessContext) =
    AnnotationService.annotationsFor(this)

  def settings(implicit ctx: DBAccessContext) =
    taskType.map(_.settings) getOrElse AnnotationSettings.defaultFor(TracingType.skeleton)

  def annotationBase(implicit ctx: DBAccessContext) =
    AnnotationService.baseFor(this)

  def countActive(implicit ctx: DBAccessContext) =
    AnnotationService.countActiveAnnotationsFor(this).getOrElse(0)

  def status(implicit ctx: DBAccessContext) = {
    for {
      active <- countActive
    } yield CompletionStatus(openInstances, active, instances - (active + openInstances))
  }

  def hasEnoughExperience(user: User) = {
    neededExperience.isEmpty || user.experiences.get(neededExperience.domain).exists(_ >= neededExperience.value)
  }
}

object Task extends FoxImplicits {
  implicit val taskFormat = Json.format[Task]

  def transformToJsonFoxed(taskFox: Fox[Task], otherFox: Fox[_])(implicit ctx: DBAccessContext): Fox[JsObject] = {
    for {
      _ <- otherFox
      task <- taskFox
      js <- transformToJson(task)
    } yield js
  }

  def transformToJson(task: Task)(implicit ctx: DBAccessContext): Fox[JsObject] = {
    for {
      dataSetName <- task.annotationBase.map(_.dataSetName)
      status <- task.status.getOrElse(CompletionStatus(-1, -1, -1))
      scriptInfo <- task._script.toFox.flatMap(sid => ScriptDAO.findOneById(sid)).futureBox
      tt <- task.taskType.map(TaskType.transformToJson) getOrElse JsNull
      scriptJs <- scriptInfo.toFox.flatMap(s => Script.scriptPublicWrites(s)).futureBox
    } yield {
      Json.obj(
        "id" -> task.id,
        "team" -> task.team,
        "formattedHash" -> Formatter.formatHash(task.id),
        "projectName" -> task._project,
        "type" -> tt,
        "dataSet" -> dataSetName,
        "neededExperience" -> task.neededExperience,
        "created" -> DateTimeFormat.forPattern("yyyy-MM-dd HH:mm").print(task.created),
        "status" -> status,
        "script" -> scriptJs.toOption,
        "tracingTime" -> task.tracingTime,
        "creationInfo" -> task.creationInfo,
        "boundingBox" -> task.boundingBox,
        "editPosition" -> task.editPosition,
        "editRotation" -> task.editRotation
      )
    }
  }

  def fromTaskSQL(s: TaskSQL)(implicit ctx: DBAccessContext): Fox[Task] = {
    for {
      taskTypeIdBson <- s._taskType.toBSONObjectId.toFox ?~> Messages("sql.invalidBSONObjectId", s._taskType.toString)
      idBson <- s._id.toBSONObjectId.toFox ?~> Messages("sql.invalidBSONObjectId", s._id.toString)
      teamIdBson <- s._team.toBSONObjectId.toFox ?~> Messages("sql.invalidBSONObjectId", s._id.toString)
      project <- ProjectSQLDAO.findOne(s._project)(GlobalAccessContext) ?~> Messages("project.notFound", s._project.toString)
      priority = if (project.paused) -1 else project.priority
      openInstances <- TaskSQLDAO.countOpenInstancesForTask(s._id)
    } yield {
      Task(
        taskTypeIdBson,
        teamIdBson,
        s.neededExperience,
        s.totalInstances.toInt,
        openInstances,
        s.boundingBox,
        s.editPosition,
        s.editRotation,
        s.tracingTime,
        new DateTime(s.created),
        !s.isDeleted,
        project.name,
        s._script.map(_.toString),
        s.creationInfo,
        priority.toInt,
        idBson
      )
    }
  }
}

object TaskDAO {

  def findOneById(id: String)(implicit ctx: DBAccessContext) =
    for {
      taskSQL <- TaskSQLDAO.findOne(ObjectId(id))
      task <- Task.fromTaskSQL(taskSQL)
    } yield task

  def findAllByTaskType(_taskType: BSONObjectID)(implicit ctx: DBAccessContext) =
    for {
      tasksSQL <- TaskSQLDAO.findAllByTaskType(ObjectId.fromBsonId(_taskType))
      tasks <- Fox.combined(tasksSQL.map(Task.fromTaskSQL(_)))
    } yield tasks

  def findAllByProject(projectName: String)(implicit ctx: DBAccessContext) =
    for {
      project <- ProjectSQLDAO.findOneByName(projectName)
      tasksSQL <- TaskSQLDAO.findAllByProject(project._id)
      tasks <- Fox.combined(tasksSQL.map(Task.fromTaskSQL(_)))
    } yield tasks

  def assignNext(user: User, teamIds: List[BSONObjectID])(implicit ctx: DBAccessContext): Fox[(Task, ObjectId)] = {
    for {
      (taskSQL, initializingAnnotationId) <- TaskSQLDAO.assignNext(ObjectId.fromBsonId(user._id), teamIds.map(ObjectId.fromBsonId(_)))
      task <- Task.fromTaskSQL(taskSQL)
    } yield (task, initializingAnnotationId)
  }

  def peekNextAssignment(user: User, teamIds: List[BSONObjectID])(implicit ctx: DBAccessContext): Fox[Task] = {
    for {
      taskSQL <- TaskSQLDAO.peekNextAssignment(ObjectId.fromBsonId(user._id), teamIds.map(ObjectId.fromBsonId(_)))
      task <- Task.fromTaskSQL(taskSQL)
    } yield task
  }

  def findAllByFilterByProjectAndTaskTypeAndIds(projectOpt: Option[String], taskTypeOpt: Option[String], idsOpt: Option[List[String]])(implicit ctx: DBAccessContext): Fox[List[Task]] =
    for {
      tasksSQL <- TaskSQLDAO.findAllByPojectAndTaskTypeAndIds(projectOpt, taskTypeOpt, idsOpt)
      tasks <- Fox.combined(tasksSQL.map(Task.fromTaskSQL(_)))
    } yield tasks

  def countAllOpenInstances(implicit ctx: DBAccessContext) =
    TaskSQLDAO.countAllOpenInstances

  def countOpenInstancesByProjects(implicit ctx: DBAccessContext): Fox[Map[String, Int]] = {
    for {
      byProjectIds <- TaskSQLDAO.countAllOpenInstancesGroupedByProjects
    } yield {
      byProjectIds.map(row => row._1.toString -> row._2).toMap
    }
  }

  def countOpenInstancesForProject(projectName: String)(implicit ctx: DBAccessContext): Fox[Int] =
    for {
      project <- ProjectSQLDAO.findOneByName(projectName)
      openInstanceCount <- TaskSQLDAO.countOpenInstancesForProject(project._id)
    } yield openInstanceCount

  def insert(task: Task)(implicit ctx: DBAccessContext): Fox[Task] =
    for {
      taskSQL <- TaskSQL.fromTask(task)
      _ <- TaskSQLDAO.insertOne(taskSQL)
    } yield task

  def removeOneAndItsAnnotations(_task: BSONObjectID)(implicit ctx: DBAccessContext): Fox[Unit] =
    TaskSQLDAO.removeOneAndItsAnnotations(ObjectId.fromBsonId(_task))

  def removeAllWithTaskTypeAndItsAnnotations(taskType: TaskType)(implicit ctx: DBAccessContext): Fox[Unit] =
    TaskSQLDAO.removeAllWithTaskTypeAndItsAnnotations(ObjectId.fromBsonId(taskType._id))

  def removeAllWithProjectAndItsAnnotations(project: Project)(implicit ctx: DBAccessContext): Fox[Unit] =
    TaskSQLDAO.removeAllWithProjectAndItsAnnotations(ObjectId.fromBsonId(project._id))

  def removeScriptFromTasks(_script: String)(implicit ctx: DBAccessContext) =
    TaskSQLDAO.removeScriptFromAllTasks(ObjectId(_script))

  def logTime(time: Long, _task: BSONObjectID)(implicit ctx: DBAccessContext) =
    TaskSQLDAO.logTime(ObjectId.fromBsonId(_task), time)

  def updateInstances(_task: BSONObjectID, instances: Int)(implicit ctx: DBAccessContext): Fox[Task] =
    for {
      _ <- TaskSQLDAO.updateTotalInstances(ObjectId.fromBsonId(_task), instances)
      updated <- findOneById(_task.stringify)
    } yield updated

  def incrementTotalInstancesOfAllWithProject(projectName: String, delta: Long)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      project <- ProjectSQLDAO.findOneByName(projectName)
      _ <- TaskSQLDAO.incrementTotalInstancesOfAllWithProject(project._id, delta)
    } yield ()

}
