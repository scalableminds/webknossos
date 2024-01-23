package models.task

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._

import javax.inject.Inject
import models.annotation._
import models.project.ProjectDAO
import models.user.Experience
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.TransactionIsolation.Serializable
import utils.sql.{SQLDAO, SqlClient, SqlToken}
import utils.ObjectId

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

case class Task(
    _id: ObjectId,
    _project: ObjectId,
    _script: Option[ObjectId],
    _taskType: ObjectId,
    neededExperience: Experience,
    totalInstances: Long,
    pendingInstances: Long,
    tracingTime: Option[Long],
    boundingBox: Option[BoundingBox],
    editPosition: Vec3Int,
    editRotation: Vec3Double,
    creationInfo: Option[String],
    created: Instant = Instant.now,
    isDeleted: Boolean = false
)

class TaskDAO @Inject()(sqlClient: SqlClient, projectDAO: ProjectDAO)(implicit ec: ExecutionContext)
    extends SQLDAO[Task, TasksRow, Tasks](sqlClient) {
  protected val collection = Tasks

  protected def idColumn(x: Tasks): profile.api.Rep[String] = x._Id
  protected def isDeletedColumn(x: Tasks): profile.api.Rep[Boolean] = x.isdeleted

  protected def parse(r: TasksRow): Fox[Task] =
    for {
      editPosition <- Vec3Int.fromList(parseArrayLiteral(r.editposition).map(_.toInt)) ?~> "could not parse edit position"
      editRotation <- Vec3Double.fromList(parseArrayLiteral(r.editrotation).map(_.toDouble)) ?~> "could not parse edit rotation"
    } yield {
      Task(
        ObjectId(r._Id),
        ObjectId(r._Project),
        r._Script.map(ObjectId(_)),
        ObjectId(r._Tasktype),
        Experience(r.neededexperienceDomain, r.neededexperienceValue),
        r.totalinstances,
        r.pendinginstances,
        r.tracingtime,
        r.boundingbox.map(b => parseArrayLiteral(b).map(_.toInt)).flatMap(BoundingBox.fromSQL),
        editPosition,
        editRotation,
        r.creationinfo,
        Instant.fromSql(r.created),
        r.isdeleted
      )
    }

  override protected def readAccessQ(requestingUserId: ObjectId) =
    q"""((select _team from webknossos.projects p where _project = p._id) in (select _team from webknossos.user_team_roles where _user = $requestingUserId)
      or ((select _organization from webknossos.teams where webknossos.teams._id = (select _team from webknossos.projects p where _project = p._id))
        in (select _organization from webknossos.users_ where _id = $requestingUserId and isAdmin)))"""
  override protected def deleteAccessQ(requestingUserId: ObjectId) =
    q"""((select _team from webknossos.projects p where _project = p._id) in (select _team from webknossos.user_team_roles where isTeamManager and _user = $requestingUserId)
      or ((select _organization from webknossos.teams where webknossos.teams._id = (select _team from webknossos.projects p where _project = p._id))
        in (select _organization from webknossos.users_ where _id = $requestingUserId and isAdmin)))"""

  private def listAccessQ(requestingUserId: ObjectId) = deleteAccessQ(requestingUserId)

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Task] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"select $columns from $existingCollectionName where _id = $id and $accessQuery".as[TasksRow])
      parsed <- parseFirst(r, id)
    } yield parsed

  override def findAll(implicit ctx: DBAccessContext): Fox[List[Task]] =
    for {
      accessQuery <- accessQueryFromAccessQ(listAccessQ)
      r <- run(q"select $columns from $existingCollectionName where $accessQuery".as[TasksRow])
      parsed <- parseAll(r)
    } yield parsed

  def findAllByTaskType(taskTypeId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[Task]] =
    findAllByProjectAndTaskTypeAndIdsAndUser(None, Some(taskTypeId), None, None, None)

  def findAllByProject(projectId: ObjectId, limit: Int, pageNumber: Int)(
      implicit ctx: DBAccessContext): Fox[List[Task]] =
    for {
      accessQuery <- accessQueryFromAccessQ(listAccessQ)
      r <- run(q"""select $columns from $existingCollectionName where _project = $projectId and $accessQuery
                   order by _id desc limit $limit offset ${pageNumber * limit}""".as[TasksRow])
      parsed <- parseAll(r)
    } yield parsed

  def countAllByProject(projectId: ObjectId)(implicit ctx: DBAccessContext): Fox[Int] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"""select count(*) from $existingCollectionName where _project = $projectId and $accessQuery""".as[Int])
      parsed <- r.headOption
    } yield parsed

  private def findNextTaskQ(userId: ObjectId, teamIds: List[ObjectId], isTeamManagerOrAdmin: Boolean) =
    q"""
          select ${columnsWithPrefix("webknossos.tasks_.")}
             from
               webknossos.tasks_
               join
                 (select domain, value
                  from webknossos.user_experiences
                  where _user = $userId)
                 as user_experiences on webknossos.tasks_.neededExperience_domain = user_experiences.domain and webknossos.tasks_.neededExperience_value <= user_experiences.value
               join webknossos.projects_ on webknossos.tasks_._project = webknossos.projects_._id
               left join (
                 select _task from webknossos.annotations_ where _user = $userId and typ = ${AnnotationType.Task} and not ($isTeamManagerOrAdmin and state = ${AnnotationState.Cancelled})
               ) as userAnnotations ON webknossos.tasks_._id = userAnnotations._task
             where webknossos.tasks_.pendingInstances > 0
                   and webknossos.projects_._team in ${SqlToken.tupleFromList(teamIds)}
                   and userAnnotations._task is null
                   and not webknossos.projects_.paused
             order by webknossos.projects_.priority desc
             limit 1
        """

  private def findNextTaskByIdQ(taskId: ObjectId) =
    q"""select $columns from $existingCollectionName
        where _id = $taskId and pendingInstances > 0
        limit 1
        """

  def assignNext(userId: ObjectId,
                 teamIds: List[ObjectId],
                 isTeamManagerOrAdmin: Boolean = false): Fox[(ObjectId, ObjectId)] = {

    val annotationId = ObjectId.generate
    val now = Instant.now

    val insertAnnotationQ = q"""
           with task as (${findNextTaskQ(userId, teamIds, isTeamManagerOrAdmin)}),
           dataset as (select _id from webknossos.datasets_ limit 1)
           insert into webknossos.annotations(_id, _dataset, _task, _team, _user, description, visibility, name, state, tags, tracingTime, typ, created, modified, isDeleted)
           select $annotationId, dataset._id, task._id, ${teamIds.headOption}, $userId, '',
                  ${AnnotationVisibility.Internal}, '', ${AnnotationState.Initializing}, '{}', 0, 'Task', $now, $now, false
           from task, dataset""".asUpdate

    for {
      _ <- run(
        insertAnnotationQ.withTransactionIsolation(Serializable),
        retryCount = 50,
        retryIfErrorContains = List(transactionSerializationError, "Negative pendingInstances for Task")
      )
      r <- run(findTaskOfInsertedAnnotationQ(annotationId))
      parsed <- parseFirst(r, "task assignment query")
    } yield (parsed._id, annotationId)
  }

  private def findTaskOfInsertedAnnotationQ(annotationId: ObjectId) =
    q"""
         select ${columnsWithPrefix("t.")}
         from webknossos.annotations_ a
         join webknossos.tasks_ t on a._task = t._id
         where a._id = $annotationId
       """.as[TasksRow]

  def assignOneTo(taskId: ObjectId, userId: ObjectId, teamIds: List[ObjectId]): Fox[(ObjectId, ObjectId)] = {
    val annotationId = ObjectId.generate
    val now = Instant.now

    val insertAnnotationQ = q"""
      with task as (${findNextTaskByIdQ(taskId)}),
      dataset as (select _id from webknossos.datasets_ limit 1)
      insert into webknossos.annotations(_id, _dataset, _task, _team, _user, description, visibility, name, state, tags, tracingTime, typ, created, modified, isDeleted)
      select $annotationId, dataset._id, task._id, ${teamIds.headOption}, $userId, '',
             ${AnnotationVisibility.Internal}, '', ${AnnotationState.Initializing}, '{}', 0, 'Task', $now, $now, false
      from task, dataset""".asUpdate

    for {
      _ <- run(
        insertAnnotationQ.withTransactionIsolation(Serializable),
        retryCount = 50,
        retryIfErrorContains = List(transactionSerializationError, "Negative pendingInstances for Task")
      )
      r <- run(findTaskOfInsertedAnnotationQ(annotationId))
      parsed <- parseFirst(r, "task assignment query")
    } yield (parsed._id, annotationId)
  }

  def peekNextAssignment(userId: ObjectId, teamIds: List[ObjectId], isTeamManagerOrAdmin: Boolean = false): Fox[Task] =
    for {
      r <- run(findNextTaskQ(userId, teamIds, isTeamManagerOrAdmin).as[TasksRow])
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

    val orderRandom = randomizeOpt match {
      case Some(true) => q"ORDER BY random()"
      case _          => q""
    }
    val projectFilter = projectIdOpt.map(pId => q"(t._project = $pId)").getOrElse(q"${true}")
    val taskTypeFilter = taskTypeIdOpt.map(ttId => q"(t._taskType = $ttId)").getOrElse(q"${true}")
    val taskIdsFilter = taskIdsOpt
      .map(tIds => if (tIds.isEmpty) q"${false}" else q"(t._id in ${SqlToken.tupleFromList(tIds)})")
      .getOrElse(q"${true}")
    val userJoin = userIdOpt
      .map(_ => q"join webknossos.annotations_ a on a._task = t._id join webknossos.users_ u on a._user = u._id")
      .getOrElse(q"")
    val userFilter = userIdOpt
      .map(uId => q"(u._id = $uId and a.typ = ${AnnotationType.Task} and a.state != ${AnnotationState.Cancelled})")
      .getOrElse(q"${true}")

    for {
      accessQuery <- accessQueryFromAccessQ(listAccessQ)
      query = q"""select $columns
                from webknossos.tasks_
                where _id in
                (select distinct t._id
                 from webknossos.tasks_ t
                 $userJoin
                 where $projectFilter
                 and $taskTypeFilter
                 and $taskIdsFilter
                 and $userFilter
                 and $accessQuery
                )
                $orderRandom
                limit 1000
                offset ${pageNumber * 1000}"""
      r <- run(query.as[TasksRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed
  }

  def countAllPendingInstancesForOrganization(organizationId: ObjectId): Fox[Long] =
    for {
      result <- run(q"""SELECT SUM(t.pendingInstances)
            FROM webknossos.tasks_ t JOIN webknossos.projects_ p ON t._project = p._id
            WHERE $organizationId in (select _organization from webknossos.users_ where _id = p._owner)""".as[Long])
      firstResult <- result.headOption
    } yield firstResult

  def countPendingInstancesAndTimeForProject(projectId: ObjectId): Fox[(Long, Long)] =
    for {
      result <- run(q"""select sum(pendingInstances), sum(tracingtime)
                        from webknossos.tasks_
                        where _project = $projectId
                        group by _project""".as[(Long, Option[Long])])
      firstResult <- result.headOption
    } yield (firstResult._1, firstResult._2.getOrElse(0L))

  def countPendingInstancesAndTimeByProject: Fox[Map[ObjectId, (Long, Long)]] =
    for {
      rowsRaw <- run(q"""select _project, sum(pendingInstances), sum(tracingtime)
                         from webknossos.tasks_
                         group by _project""".as[(String, Long, Option[Long])])
    } yield rowsRaw.toList.map(r => (ObjectId(r._1), (r._2, r._3.getOrElse(0L)))).toMap

  def listExperienceDomains(organizationId: ObjectId): Fox[List[String]] =
    for {
      rowsRaw <- run(
        q"select domain from webknossos.experienceDomains where _organization = $organizationId".as[String])
    } yield rowsRaw.toList

  def insertOne(t: Task): Fox[Unit] =
    for {
      _ <- run(q"""insert into webknossos.tasks(_id, _project, _script, _taskType,
                                         neededExperience_domain, neededExperience_value,
                                         totalInstances, pendingInstances, tracingTime, boundingBox,
                                         editPosition, editRotation, creationInfo,
                                         created, isDeleted)
                   values(${t._id}, ${t._project}, ${t._script}, ${t._taskType},
                          ${t.neededExperience.domain}, ${t.neededExperience.value},
                          ${t.totalInstances}, ${t.totalInstances}, ${t.tracingTime}, ${t.boundingBox},
                          ${t.editPosition}, ${t.editRotation}, ${t.creationInfo},
                          ${t.created}, ${t.isDeleted})
        """.asUpdate)
    } yield ()

  def updateTotalInstances(id: ObjectId, newTotalInstances: Long)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val query = for { c <- Tasks if c._Id === id.id } yield c.totalinstances
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(query.update(newTotalInstances).withTransactionIsolation(Serializable),
               retryCount = 50,
               retryIfErrorContains = List(transactionSerializationError))
    } yield ()
  }

  def incrementTotalInstancesOfAllWithProject(projectId: ObjectId, delta: Long)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      accessQuery <- readAccessQuery
      _ <- run(
        q"update webknossos.tasks set totalInstances = totalInstances + $delta where _project = $projectId and $accessQuery".asUpdate
          .withTransactionIsolation(Serializable),
        retryCount = 50,
        retryIfErrorContains = List(transactionSerializationError)
      )
    } yield ()

  def removeScriptFromAllTasks(scriptId: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"update webknossos.tasks set _script = null where _script = $scriptId".asUpdate)
    } yield ()

  def logTime(id: ObjectId, time: FiniteDuration)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q"""update webknossos.tasks
                   set tracingTime = coalesce(tracingTime, 0) + ${time.toMillis}
                   where _id = $id""".asUpdate)
    } yield ()

  def removeOneAndItsAnnotations(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val queries = List(
      q"update webknossos.tasks set isDeleted = true where _id = $id".asUpdate,
      q"update webknossos.annotations set isDeleted = true where _task = $id".asUpdate
    )
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(DBIO.sequence(queries).transactionally)
    } yield ()
  }

  def removeAllWithTaskTypeAndItsAnnotations(taskTypeId: ObjectId): Fox[Unit] = {
    val queries = List(
      q"update webknossos.tasks set isDeleted = true where _taskType = $taskTypeId".asUpdate,
      q"""update webknossos.annotations set isDeleted = true
          where _task in (select _id from webknossos.tasks where _taskType = $taskTypeId)""".asUpdate
    )
    for {
      _ <- run(DBIO.sequence(queries).transactionally)
    } yield ()
  }

  def removeAllWithProjectAndItsAnnotations(projectId: ObjectId): Fox[Unit] = {
    val queries = List(
      q"update webknossos.tasks set isDeleted = true where _project = $projectId".asUpdate,
      q"""update webknossos.annotations set isDeleted = true
          where _task in (select _id from webknossos.tasks where _project = $projectId)""".asUpdate
    )
    for {
      _ <- run(DBIO.sequence(queries).transactionally)
    } yield ()
  }

}
