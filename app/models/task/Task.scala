package models.task

import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.reactivemongo.AccessRestrictions.{AllowIf, DenyEveryone}
import com.scalableminds.util.reactivemongo.{DBAccessContext, DefaultAccessDefinitions, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.tracings.TracingType
import com.scalableminds.webknossos.schema.Tables._
import models.annotation._
import models.basics._
import models.project.{Project, ProjectDAO, ProjectSQLDAO}
import models.team.{Team, TeamSQL, TeamSQLDAO}
import models.user.{Experience, User}
import org.joda.time.DateTime
import org.joda.time.format.DateTimeFormat
import play.api.Play.current
import play.api.i18n.Messages
import play.api.i18n.Messages.Implicits._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.iteratee.Enumerator
import play.api.libs.json.{JsArray, JsNull, JsObject, Json}
import reactivemongo.api.collections.bson.BSONCollection
import reactivemongo.api.indexes.{Index, IndexType}
import reactivemongo.bson.{BSONObjectID, BSONString}
import reactivemongo.core.commands.SumField
import reactivemongo.play.json.BSONFormats._
import slick.jdbc.PostgresProfile.api._
import utils.{ObjectId, SQLDAO}


case class TaskSQL(
                  _id: ObjectId,
                  _project: ObjectId,
                  _script: Option[ObjectId],
                  _taskType: ObjectId,
                  _team: ObjectId,
                  neededExperience: Experience,
                  totalInstances: Long,
                  tracingTime: Option[Long], //TODO: INTERVAL?
                  boundingBox: Option[BoundingBox],
                  editPosition: Point3D, //TODO: discern in schema between point (int) and vector (double)?
                  editRotation: Vector3D,
                  creationInfo: Option[String],
                  created: Long = System.currentTimeMillis(),
                  isDeleted: Boolean = false
                  )

object TaskSQL {
  def fromTask(t: Task)(implicit ctx: DBAccessContext): Fox[TaskSQL] = {
    for {
      project <- ProjectSQLDAO.findOneByName(t._project)
      team <- TeamSQLDAO.findOneByName(t.team)
    } yield {
      TaskSQL(
        ObjectId.fromBsonId(t._id),
        project._id,
        t._script.map(ObjectId(_)),
        ObjectId.fromBsonId(t._taskType),
        team._id,
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

  def findAllAdministrable(user: User, limit: Int)(implicit ctx: DBAccessContext): Fox[List[TaskSQL]] =
    for {
      teams: List[TeamSQL] <- Fox.successful(List()) //TODO
      r <- run(Tasks.filter(t => notdel(t) && t._Team.inSetBind(teams.map(team => team._id.id))).take(limit).result)
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def findAllByTaskType(taskTypeId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[TaskSQL]] =
    for {
      r <- run(Tasks.filter(t => notdel(t) && t._Tasktype === taskTypeId.id).result)
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def findAllByProject(projectId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[TaskSQL]] =
    for {
      r <- run(Tasks.filter(t => notdel(t) && t._Project === projectId.id).result)
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def findAllAssignableFor(userId: ObjectId, teamIds: List[ObjectId], limit: Option[Int])(implicit ctx: DBAccessContext): Fox[List[TaskSQL]] = {
    val q = sql"""
           select webknossos.tasks.*
           from
             (webknossos.tasks
             join webknossos.task_instances on webknossos.tasks._id = webknossos.task_instances._id)
             join
               (select *
                from webknossos.user_experiences
                where _user = ${userId.id})
               as user_experiences on webknossos.tasks.neededExperience_domain = user_experiences.domain and webknossos.tasks.neededExperience_value >= user_experiences.value
             join webknossos.projects on webknossos.tasks._project = webknossos.projects._id
           where webknossos.task_instances.openInstances > 0 and webknossos.tasks._team in #${writeStructTupleWithQuotes(teamIds.map(t => sanitize(t.id)))}
           order by webknossos.projects.priority
           limit ${limit};
      """

    for {
      r <- run(q.as[TasksRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed
  }

  def openInstanceCountForTask(taskId: ObjectId): Fox[Int] = {
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

  def countOpenInstancesByProjects(implicit ctx: DBAccessContext): Fox[List[(ObjectId, Int)]] = {
    for {
      rowsRaw <- run(
        sql"""select webknossos.tasks._project, sum(webknossos.task_instances.openInstances)
              from webknossos.tasks join webknossos.task_instances on webknossos.tasks._id = webknossos.task_instances._id
              group by webknossos.tasks._project
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

  def updateTotalInstances(taskId: ObjectId, newTotalInstances: Long): Fox[Unit] = {
    val q = for { c <- Tasks if c._Id === taskId.id } yield c.totalinstances
    for {
      _ <- run(q.update(newTotalInstances))
    } yield ()
  }

  def removeScriptFromTasks(scriptId: ObjectId): Fox[Unit] = {
    for {
      _ <- run(sqlu"update webknossos.tasks set _script = null where _script = ${scriptId.id}")
    } yield ()
  }

  def logTime(taskId: ObjectId, time: Long)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- run(sqlu"update webknossos.tasks set tracingTime = tracingTime + $time where _id = ${taskId.id}")
    } yield ()

  def removeOneAndItsAnnotations(taskId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val queries = List(
      sqlu"update webknossos.tasks set isDeleted = true where _id = ${taskId.id}",
      sqlu"update webknossos.annotations set isDeleted = true where _task = (select _id from webknossos.tasks where _id = ${taskId.id})"
    )
    for {
      _ <- run(DBIO.sequence(queries).transactionally)
    } yield ()
  }

  def removeAllWithTaskTypeAndItsAnnotations(taskTypeId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val queries = List(
      sqlu"update webknossos.tasks set isDeleted = true where _taskType = ${taskTypeId.id}",
      sqlu"update webknossos.annotations set isDeleted = true where _task in (select _id from webknossos.tasks where _id = ${taskTypeId.id})"
    )
    for {
      _ <- run(DBIO.sequence(queries).transactionally)
    } yield ()
  }

  def removeAllWithProjectAndItsAnnotations(projectId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val queries = List(
      sqlu"update webknossos.tasks set isDeleted = true where _project = ${projectId.id}",
      sqlu"update webknossos.annotations set isDeleted = true where _task in (select _id from webknossos.tasks where _id = ${projectId.id})"
    )
    for {
      _ <- run(DBIO.sequence(queries).transactionally)
    } yield ()
  }

}







class info(message: String) extends scala.annotation.StaticAnnotation

case class Task(
                 @info("Reference to task type") _taskType: BSONObjectID,
                 @info("Assigned name") team: String,
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
      team <- TeamSQLDAO.findOne(s._team) ?~> Messages("team.notFound")
      project <- ProjectSQLDAO.findOne(s._project) ?~> Messages("project.notFound", s._project.toString)
      priority = if (project.paused) -1 else project.priority
      openInstances <- TaskSQLDAO.openInstanceCountForTask(s._id)
    } yield {
      Task(
        taskTypeIdBson,
        team.name,
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
/*
  underlying.indexesManager.ensure(Index(Seq("_project" -> IndexType.Ascending)))
  underlying.indexesManager.ensure(Index(Seq("team" -> IndexType.Ascending)))
  underlying.indexesManager.ensure(Index(Seq("_taskType" -> IndexType.Ascending)))
  underlying.indexesManager.ensure(Index(Seq("_user" -> IndexType.Ascending, "_task" -> IndexType.Ascending)))
  underlying.indexesManager.ensure(Index(Seq("priority" -> IndexType.Descending)))
  underlying.indexesManager.ensure(Index(Seq("team" -> IndexType.Ascending, "neededExperience" -> IndexType.Ascending, "priority" -> IndexType.Descending)))
*/

/*  override val AccessDefinitions = new DefaultAccessDefinitions {

    override def findQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match {
        case Some(user: User) =>
          AllowIf(Json.obj("team" -> Json.obj("$in" -> user.teamNames)))
        case _ =>
          DenyEveryone()
      }
    }

    override def removeQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match {
        case Some(user: User) =>
          AllowIf(Json.obj("team" -> Json.obj("$in" -> user.adminTeamNames)))
        case _ =>
          DenyEveryone()
      }
    }
  }*/

  def findOneById(id: String)(implicit ctx: DBAccessContext) =
    for {
      taskSQL <- TaskSQLDAO.findOne(ObjectId(id))
      parsed <- Task.fromTaskSQL(taskSQL)
    } yield {
      parsed
    }

  def findAllAdministratable(user: User, limit: Int)(implicit ctx: DBAccessContext) =
    for {
      tasksSQL <- TaskSQLDAO.findAllAdministrable(user, limit)
      tasks <- Fox.combined(tasksSQL.map(Task.fromTaskSQL(_)))
    } yield tasks

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

  /* TODO Reports
  def sumInstancesByProject(project: String)(implicit ctx: DBAccessContext) = withExceptionCatcher {
    sumValues(Json.obj("_project" -> project), "instances")
  }

  def findAllByProjectReturnOnlyIds(project: String)(implicit ctx: DBAccessContext) = {
    for {
      jsObjects <- findWithProjection(Json.obj("_project" -> project), Json.obj("_id" -> 1)).cursor[JsObject]().collect[List]()
    } yield {
      jsObjects.map(p => (p \ "_id").asOpt[BSONObjectID]).flatten
    }
  }

  def findOneByProject(projectName: String)(implicit ctx: DBAccessContext) = findOne(Json.obj("_project" -> projectName))


  def findWithOpenByUserReturnOnlyProject(user: User)(implicit ctx: DBAccessContext) = {
    for {
      jsObjects <- findWithProjection(validPriorityQ ++ Json.obj(
        "openInstances" -> Json.obj("$gt" -> 0),
        "team" -> Json.obj("$in" -> user.teamNames),
        "$or" -> (experienceQueryFor(user) :+ noRequiredExperience)), Json.obj("_project" -> 1, "_id" -> 0)).cursor[JsObject]().collect[List]()
    } yield {
      jsObjects.map(p => (p \ "_project").asOpt[String]).flatten
    }
  }
  */
  def sumInstancesByProject(project: String)(implicit ctx: DBAccessContext): Fox[Int] = Fox.failure("not implemented")
  def findAllByProjectReturnOnlyIds(project: String)(implicit ctx: DBAccessContext): Fox[List[BSONObjectID]] = Fox.failure("not implemented")
  def findOneByProject(projectName: String)(implicit ctx: DBAccessContext): Fox[Task] = Fox.failure("not implemented")
  def findWithOpenByUserReturnOnlyProject(user: User)(implicit ctx: DBAccessContext): Fox[List[String]] = Fox.failure("not implemented")



  def removeScriptFromTasks(_script: String)(implicit ctx: DBAccessContext) =
    TaskSQLDAO.removeScriptFromTasks(ObjectId(_script))

  def logTime(time: Long, _task: BSONObjectID)(implicit ctx: DBAccessContext) =
    TaskSQLDAO.logTime(ObjectId.fromBsonId(_task), time)

  def updateInstances(_task: BSONObjectID, instances: Int)(implicit ctx: DBAccessContext): Fox[Task] =
    for {
      _ <- TaskSQLDAO.updateTotalInstances(ObjectId.fromBsonId(_task), instances)
      updated <- findOneById(_task.stringify)
    } yield updated


  def findAllAssignableFor(user: User, teamNames: List[String], limit: Option[Int] = None)(implicit ctx: DBAccessContext): Fox[List[Task]] = {
    for {
      teams <- Fox.combined(teamNames.map(TeamSQLDAO.findOneByName(_)))
      tasksSQL <- TaskSQLDAO.findAllAssignableFor(ObjectId.fromBsonId(user._id), teams.map(_._id), limit)
      tasks <- Fox.combined(tasksSQL.map(Task.fromTaskSQL(_)))
    } yield tasks
  }

  def countAllOpenInstances(implicit ctx: DBAccessContext) =
    TaskSQLDAO.countAllOpenInstances

  def countOpenInstancesByProjects(implicit ctx: DBAccessContext): Fox[Map[String, Int]] = {
    for {
      byProjectIds <- TaskSQLDAO.countOpenInstancesByProjects
    } yield {
      byProjectIds.map(row => row._1.toString -> row._2).toMap
    }
  }


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



  // TODO

  def findAllByProjectTaskTypeIds(projectOpt: Option[String], taskTypeOpt: Option[String], idsOpt: Option[List[String]])(implicit ctx: DBAccessContext): Fox[List[Task]] = {
    val projectFilter = projectOpt match {
      case Some(project) => Json.obj(("_project") -> Json.toJson(project))
      case None => Json.obj()
    }

    val taskTypeFilter = taskTypeOpt match {
      case Some(taskType) => Json.obj(("_taskType") -> Json.obj("$oid" -> taskType))
      case None => Json.obj()
    }

    val idsFilter = idsOpt match {
      case Some(ids) => Json.obj(("_id") -> Json.obj("$in" -> ids.filter(BSONObjectID.parse(_).isSuccess).map(id => Json.obj("$oid" -> id))))
      case None => Json.obj()
    }

    //find(projectFilter ++ taskTypeFilter ++ idsFilter).cursor[Task]().collect[List]()
    Fox.failure("")
  }



}
