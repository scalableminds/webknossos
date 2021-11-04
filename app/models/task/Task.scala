package models.task

import com.scalableminds.util.geometry.{BoundingBox, Point3D, Vector3D}
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables.{profile, _}
import javax.inject.Inject
import models.annotation._
import models.project.ProjectDAO
import models.user.Experience
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.TransactionIsolation.Serializable
import utils.{ObjectId, SQLClient, SQLDAO}

import scala.concurrent.ExecutionContext
import scala.util.Random

case class Task(
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
)

class TaskDAO @Inject()(sqlClient: SQLClient, projectDAO: ProjectDAO)(implicit ec: ExecutionContext)
    extends SQLDAO[Task, TasksRow, Tasks](sqlClient) {
  val collection = Tasks

  def idColumn(x: Tasks): profile.api.Rep[String] = x._Id
  def isDeletedColumn(x: Tasks): profile.api.Rep[Boolean] = x.isdeleted

  def parse(r: TasksRow): Fox[Task] =
    for {
      editPosition <- Point3D.fromList(parseArrayTuple(r.editposition).map(_.toInt)) ?~> "could not parse edit position"
      editRotation <- Vector3D.fromList(parseArrayTuple(r.editrotation).map(_.toDouble)) ?~> "could not parse edit rotation"
    } yield {
      Task(
        ObjectId(r._Id),
        ObjectId(r._Project),
        r._Script.map(ObjectId(_)),
        ObjectId(r._Tasktype),
        Experience(r.neededexperienceDomain, r.neededexperienceValue),
        r.totalinstances,
        r.openinstances,
        r.tracingtime,
        r.boundingbox.map(b => parseArrayTuple(b).map(_.toInt)).flatMap(BoundingBox.fromSQL),
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

  private def listAccessQ(requestingUserId: ObjectId) = deleteAccessQ(requestingUserId)

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Task] =
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select #$columns from #$existingCollectionName where _id = ${id.id} and #$accessQuery".as[TasksRow])
      parsed <- parseFirst(r, id)
    } yield parsed

  override def findAll(implicit ctx: DBAccessContext): Fox[List[Task]] =
    for {
      accessQuery <- accessQueryFromAccessQ(listAccessQ)
      r <- run(sql"select #$columns from #$existingCollectionName where #$accessQuery".as[TasksRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def findAllByTaskType(taskTypeId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[Task]] =
    findAllByProjectAndTaskTypeAndIdsAndUser(None, Some(taskTypeId), None, None, None)

  def findAllByProject(projectId: ObjectId, limit: Int, pageNumber: Int)(
      implicit ctx: DBAccessContext): Fox[List[Task]] =
    for {
      accessQuery <- accessQueryFromAccessQ(listAccessQ)
      r <- run(sql"""select #$columns from #$existingCollectionName where _project = ${projectId.id} and #$accessQuery
              order by _id desc limit $limit offset ${pageNumber * limit}""".as[TasksRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def countAllByProject(projectId: ObjectId)(implicit ctx: DBAccessContext): Fox[Int] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        sql"""select count(*) from #$existingCollectionName where _project = ${projectId.id} and #$accessQuery"""
          .as[Int])
      parsed <- r.headOption
    } yield parsed

  private def findNextTaskQ(userId: ObjectId, teamIds: List[ObjectId], isTeamManagerOrAdmin: Boolean) =
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
             left join (select _task from webknossos.annotations_ where _user = '${userId.id}' and typ = '${AnnotationType.Task}' and not ($isTeamManagerOrAdmin and state = '${AnnotationState.Cancelled}')) as userAnnotations ON webknossos.tasks_._id = userAnnotations._task
           where webknossos.tasks_.openInstances > 0
                 and webknossos.projects_._team in ${writeStructTupleWithQuotes(teamIds.map(t => sanitize(t.id)))}
                 and userAnnotations._task is null
                 and not webknossos.projects_.paused
           order by webknossos.projects_.priority desc
           limit 1
      """

  def assignNext(userId: ObjectId,
                 teamIds: List[ObjectId],
                 isTeamManagerOrAdmin: Boolean = false): Fox[(Task, ObjectId)] = {

    val annotationId = ObjectId.generate
    val preliminaryTracingId = Random.alphanumeric.take(36).mkString

    val insertAnnotationQ = sqlu"""
           with task as (#${findNextTaskQ(userId, teamIds, isTeamManagerOrAdmin)}),
           dataset as (select _id from webknossos.datasets_ limit 1)
           insert into webknossos.annotations(_id, _dataSet, _task, _team, _user, skeletonTracingId, volumeTracingId, description, visibility, name, state, statistics, tags, tracingTime, typ, created, modified, isDeleted)
           select ${annotationId.id}, dataset._id, task._id, ${teamIds.headOption
      .map(_.id)
      .getOrElse("")}, ${userId.id}, $preliminaryTracingId,
                    null, '', '#${AnnotationVisibility.Internal}', '', '#${AnnotationState.Initializing.toString}', '{}',
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
      _ <- run(
        insertAnnotationQ.withTransactionIsolation(Serializable),
        retryCount = 50,
        retryIfErrorContains = List(transactionSerializationError, "Negative openInstances for Task")
      )
      r <- run(findTaskOfInsertedAnnotationQ)
      parsed <- parseFirst(r, "task assignment query")
    } yield (parsed, annotationId)
  }

  def peekNextAssignment(userId: ObjectId, teamIds: List[ObjectId], isTeamManagerOrAdmin: Boolean = false): Fox[Task] =
    for {
      r <- run(sql"#${findNextTaskQ(userId, teamIds, isTeamManagerOrAdmin)}".as[TasksRow])
      parsed <- parseFirst(r, "task peek query")
    } yield parsed

  def findAllByProjectAndTaskTypeAndIdsAndUser(
      projectIdOpt: Option[ObjectId],
      taskTypeIdOpt: Option[ObjectId],
      taskIdsOpt: Option[List[ObjectId]],
      userIdOpt: Option[ObjectId],
      randomizeOpt: Option[Boolean],
      pageNumber: Int = 0
  )(implicit ctx: DBAccessContext): Fox[List[Task]] = {

    /* WARNING: This code composes an sql query with #${} without sanitize(). Change with care. */

    val orderRandom = randomizeOpt match {
      case Some(true) => "ORDER BY random()"
      case _          => ""
    }
    val projectFilter = projectIdOpt.map(pId => s"(t._project = '$pId')").getOrElse("true")
    val taskTypeFilter = taskTypeIdOpt.map(ttId => s"(t._taskType = '$ttId')").getOrElse("true")
    val taskIdsFilter = taskIdsOpt
      .map(tIds => if (tIds.isEmpty) "false" else s"(t._id in ${writeStructTupleWithQuotes(tIds.map(_.toString))})")
      .getOrElse("true")
    val userJoin = userIdOpt
      .map(_ => "join webknossos.annotations_ a on a._task = t._id join webknossos.users_ u on a._user = u._id")
      .getOrElse("")
    val userFilter = userIdOpt
      .map(uId =>
        s"(u._id = '$uId' and a.typ = '${AnnotationType.Task}' and a.state != '${AnnotationState.Cancelled}')")
      .getOrElse("true")

    for {
      accessQuery <- accessQueryFromAccessQ(listAccessQ)
      q = sql"""select #${columns}
                from webknossos.tasks_
                where _id in
                (select distinct t._id
                 from webknossos.tasks_ t
                 #$userJoin
                 where #$projectFilter
                 and #$taskTypeFilter
                 and #$taskIdsFilter
                 and #$userFilter
                 and #$accessQuery
                )
                #$orderRandom
                limit 1000
                offset #${pageNumber * 1000}"""
      r <- run(q.as[TasksRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed
  }

  def countOpenInstancesForTask(taskId: ObjectId): Fox[Long] =
    for {
      result <- run(sql"select openInstances from webknossos.tasks_ where _id = ${taskId.toString}".as[Long])
      firstResult <- result.headOption.toFox
    } yield firstResult

  def countAllOpenInstancesForOrganization(organizationId: ObjectId): Fox[Long] =
    for {
      result <- run(
        sql"select sum(t.openInstances) from webknossos.tasks_ t join webknossos.projects_ p on t._project = p._id where $organizationId in (select _organization from webknossos.users_ where _id = p._owner)"
          .as[Long])
      firstResult <- result.headOption
    } yield firstResult

  def countOpenInstancesAndTimeForProject(projectId: ObjectId): Fox[(Long, Long)] =
    for {
      result <- run(sql"""select sum(openInstances), sum(tracingtime)
                          from webknossos.tasks_
                          where _project = ${projectId.id}
                          group by _project""".as[(Long, Option[Long])])
      firstResult <- result.headOption
    } yield (firstResult._1, firstResult._2.getOrElse(0L))

  def countOpenInstancesAndTimeByProject: Fox[Map[ObjectId, (Long, Long)]] =
    for {
      rowsRaw <- run(sql"""select _project, sum(openInstances), sum(tracingtime)
              from webknossos.tasks_
              group by _project
           """.as[(String, Long, Option[Long])])
    } yield rowsRaw.toList.map(r => (ObjectId(r._1), (r._2, r._3.getOrElse(0L)))).toMap

  def listExperienceDomains(organizationId: ObjectId): Fox[List[String]] =
    for {
      rowsRaw <- run(
        sql"select domain from webknossos.experienceDomains where _organization = $organizationId".as[String])
    } yield rowsRaw.toList

  def insertOne(t: Task): Fox[Unit] =
    for {
      _ <- run(
        sqlu"""insert into webknossos.tasks(_id, _project, _script, _taskType, neededExperience_domain, neededExperience_value,
                                             totalInstances, openInstances, tracingTime, boundingBox, editPosition, editRotation, creationInfo, created, isDeleted)
                   values(${t._id.id}, ${t._project.id}, #${optionLiteral(t._script.map(s => sanitize(s.id)))}, ${t._taskType.id},
                          ${t.neededExperience.domain}, ${t.neededExperience.value},
                          ${t.totalInstances}, ${t.totalInstances}, ${t.tracingTime}, #${optionLiteral(
          t.boundingBox.map(_.toSql.map(_.toString)).map(writeStructTuple))},
                           '#${writeStructTuple(t.editPosition.toList.map(_.toString))}', '#${writeStructTuple(
          t.editRotation.toList.map(_.toString))}',
                           #${optionLiteral(t.creationInfo.map(sanitize))}, ${new java.sql.Timestamp(t.created)}, ${t.isDeleted})
        """)
    } yield ()

  def updateTotalInstances(id: ObjectId, newTotalInstances: Long)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for { c <- Tasks if c._Id === id.id } yield c.totalinstances
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q.update(newTotalInstances).withTransactionIsolation(Serializable),
               retryCount = 50,
               retryIfErrorContains = List(transactionSerializationError))
    } yield ()
  }

  def incrementTotalInstancesOfAllWithProject(projectId: ObjectId, delta: Long)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      accessQuery <- readAccessQuery
      _ <- run(
        sqlu"update webknossos.tasks set totalInstances = totalInstances + $delta where _project = ${projectId.id} and #$accessQuery"
          .withTransactionIsolation(Serializable),
        retryCount = 50,
        retryIfErrorContains = List(transactionSerializationError)
      )
    } yield ()

  def removeScriptFromAllTasks(scriptId: ObjectId): Fox[Unit] =
    for {
      _ <- run(sqlu"update webknossos.tasks set _script = null where _script = ${scriptId.id}")
    } yield ()

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

  def removeAllWithTaskTypeAndItsAnnotations(taskTypeId: ObjectId): Fox[Unit] = {
    val queries = List(
      sqlu"update webknossos.tasks set isDeleted = true where _taskType = ${taskTypeId.id}",
      sqlu"update webknossos.annotations set isDeleted = true where _task in (select _id from webknossos.tasks where _taskType = ${taskTypeId.id})"
    )
    for {
      _ <- run(DBIO.sequence(queries).transactionally)
    } yield ()
  }

  def removeAllWithProjectAndItsAnnotations(projectId: ObjectId): Fox[Unit] = {
    val queries = List(
      sqlu"update webknossos.tasks set isDeleted = true where _project = ${projectId.id}",
      sqlu"update webknossos.annotations set isDeleted = true where _task in (select _id from webknossos.tasks where _project = ${projectId.id})"
    )
    for {
      _ <- run(DBIO.sequence(queries).transactionally)
    } yield ()
  }

}
