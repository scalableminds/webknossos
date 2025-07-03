package models.task

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.geometry.{BoundingBox, Vec3Double, Vec3Int}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import com.scalableminds.webknossos.tracingstore.tracings.NamedBoundingBox

import javax.inject.Inject
import models.annotation._
import models.user.Experience
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.TransactionIsolation.Serializable
import utils.sql.{SQLDAO, SqlClient, SqlToken}

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

class TaskDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[Task, TasksRow, Tasks](sqlClient) {
  protected val collection = Tasks

  protected def idColumn(x: Tasks): profile.api.Rep[String] = x._Id
  protected def isDeletedColumn(x: Tasks): profile.api.Rep[Boolean] = x.isdeleted

  protected def parse(r: TasksRow): Fox[Task] =
    for {
      editPosition <- Vec3Int
        .fromList(parseArrayLiteral(r.editposition).map(_.toInt))
        .toFox ?~> "could not parse edit position"
      editRotation <- Vec3Double
        .fromList(parseArrayLiteral(r.editrotation).map(_.toDouble))
        .toFox ?~> "could not parse edit rotation"
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
        parseBboxOpt(r.boundingbox),
        editPosition,
        editRotation,
        r.creationinfo,
        Instant.fromSql(r.created),
        r.isdeleted
      )
    }

  private def parseBboxOpt(bboxLiteral: Option[String]): Option[BoundingBox] =
    bboxLiteral.map(b => parseArrayLiteral(b).map(_.toInt)).flatMap(BoundingBox.fromSQL)

  override protected def readAccessQ(requestingUserId: ObjectId) =
    q"""((SELECT _team FROM webknossos.projects p WHERE _project = p._id) IN (SELECT _team FROM webknossos.user_team_roles WHERE _user = $requestingUserId)
      or ((SELECT _organization FROM webknossos.teams WHERE webknossos.teams._id = (SELECT _team FROM webknossos.projects p WHERE _project = p._id))
        in (SELECT _organization FROM webknossos.users_ WHERE _id = $requestingUserId AND isAdmin)))"""
  override protected def deleteAccessQ(requestingUserId: ObjectId) =
    q"""((SELECT _team FROM webknossos.projects p WHERE _project = p._id) IN (SELECT _team FROM webknossos.user_team_roles WHERE isTeamManager AND _user = $requestingUserId)
      or ((SELECT _organization FROM webknossos.teams WHERE webknossos.teams._id = (SELECT _team FROM webknossos.projects p WHERE _project = p._id))
        in (SELECT _organization FROM webknossos.users_ WHERE _id = $requestingUserId AND isAdmin)))"""

  private def listAccessQ(requestingUserId: ObjectId) = deleteAccessQ(requestingUserId)

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Task] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE _id = $id AND $accessQuery".as[TasksRow])
      parsed <- parseFirst(r, id)
    } yield parsed

  override def findAll(implicit ctx: DBAccessContext): Fox[List[Task]] =
    for {
      accessQuery <- accessQueryFromAccessQ(listAccessQ)
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE $accessQuery".as[TasksRow])
      parsed <- parseAll(r)
    } yield parsed

  def findAllByTaskType(taskTypeId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[Task]] =
    findAllByProjectAndTaskTypeAndIdsAndUser(None, Some(taskTypeId), None, None, None)

  def findAllByProject(projectId: ObjectId, limit: Int, pageNumber: Int)(
      implicit ctx: DBAccessContext): Fox[List[Task]] =
    for {
      accessQuery <- accessQueryFromAccessQ(listAccessQ)
      r <- run(q"""SELECT $columns
                   FROM $existingCollectionName
                   WHERE _project = $projectId
                   AND $accessQuery
                   ORDER BY _id DESC
                   LIMIT $limit
                   OFFSET ${pageNumber * limit}""".as[TasksRow])
      parsed <- parseAll(r)
    } yield parsed

  def countAllByProject(projectId: ObjectId)(implicit ctx: DBAccessContext): Fox[Int] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"""SELECT COUNT(*) FROM $existingCollectionName WHERE _project = $projectId AND $accessQuery""".as[Int])
      parsed <- r.headOption.toFox
    } yield parsed

  private def findNextTaskQ(userId: ObjectId, teamIds: List[ObjectId], isTeamManagerOrAdmin: Boolean) =
    q"""
          SELECT ${columnsWithPrefix("webknossos.tasks_.")}
          FROM webknossos.tasks_
          JOIN (
            SELECT domain, value
            FROM webknossos.user_experiences
            WHERE _user = $userId
          ) AS user_experiences ON webknossos.tasks_.neededExperience_domain = user_experiences.domain AND webknossos.tasks_.neededExperience_value <= user_experiences.value
          JOIN webknossos.projects_ ON webknossos.tasks_._project = webknossos.projects_._id
          LEFT JOIN (
            SELECT _task
            FROM webknossos.annotations_
            WHERE _user = $userId
            AND typ = ${AnnotationType.Task}
            AND NOT (
              $isTeamManagerOrAdmin
              AND state = ${AnnotationState.Cancelled}
            )
          ) AS userAnnotations ON webknossos.tasks_._id = userAnnotations._task
          WHERE webknossos.tasks_.pendingInstances > 0
          AND webknossos.projects_._team IN ${SqlToken.tupleFromList(teamIds)}
          AND userAnnotations._task IS NULL
          AND NOT webknossos.projects_.paused
          ORDER BY webknossos.projects_.priority DESC
          LIMIT 1
        """

  private def findNextTaskByIdQ(taskId: ObjectId) =
    q"""SELECT $columns
        FROM $existingCollectionName
        WHERE _id = $taskId
        AND pendingInstances > 0
        LIMIT 1"""

  def assignNext(userId: ObjectId,
                 teamIds: List[ObjectId],
                 isTeamManagerOrAdmin: Boolean = false): Fox[(ObjectId, ObjectId)] = {

    val annotationId = ObjectId.generate
    val now = Instant.now

    val insertAnnotationQ = q"""
           WITH task AS (${findNextTaskQ(userId, teamIds, isTeamManagerOrAdmin)})
           ,dataset AS (SELECT _id FROM webknossos.datasets_ LIMIT 1)
           INSERT INTO webknossos.annotations(_id, _dataset, _task, _team, _user, description, visibility, name, state, tags, tracingTime, typ, created, modified, isDeleted)
           SELECT $annotationId, dataset._id, task._id, ${teamIds.headOption}, $userId, '',
                  ${AnnotationVisibility.Internal}, '', ${AnnotationState.Initializing}, '{}', 0, 'Task', $now, $now, FALSE
           FROM task, dataset""".asUpdate

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
    q"""SELECT ${columnsWithPrefix("t.")}
        FROM webknossos.annotations_ a
        JOIN webknossos.tasks_ t ON a._task = t._id
        WHERE a._id = $annotationId""".as[TasksRow]

  def assignOneTo(taskId: ObjectId, userId: ObjectId, teamIds: List[ObjectId]): Fox[(ObjectId, ObjectId)] = {
    val annotationId = ObjectId.generate
    val now = Instant.now

    val insertAnnotationQ = q"""
      WITH task AS (${findNextTaskByIdQ(taskId)})
      ,dataset AS (SELECT _id FROM webknossos.datasets_ LIMIT 1)
      INSERT INTO webknossos.annotations(_id, _dataset, _task, _team, _user, description, visibility, name, state, tags, tracingTime, typ, created, modified, isDeleted)
      SELECT $annotationId, dataset._id, task._id, ${teamIds.headOption}, $userId, '',
             ${AnnotationVisibility.Internal}, '', ${AnnotationState.Initializing}, '{}', 0, 'Task', $now, $now, FALSE
      FROM task, dataset""".asUpdate

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
      case Some(true) => q"ORDER BY RANDOM()"
      case _          => q""
    }
    val projectFilter = projectIdOpt.map(pId => q"(t._project = $pId)").getOrElse(q"TRUE")
    val taskTypeFilter = taskTypeIdOpt.map(ttId => q"(t._taskType = $ttId)").getOrElse(q"TRUE")
    val taskIdsFilter = taskIdsOpt
      .map(tIds => if (tIds.isEmpty) q"FALSE" else q"(t._id IN ${SqlToken.tupleFromList(tIds)})")
      .getOrElse(q"TRUE")
    val userJoin = userIdOpt
      .map(_ => q"JOIN webknossos.annotations_ a ON a._task = t._id JOIN webknossos.users_ u ON a._user = u._id")
      .getOrElse(q"")
    val userFilter = userIdOpt
      .map(uId => q"(u._id = $uId AND a.typ = ${AnnotationType.Task} AND a.state != ${AnnotationState.Cancelled})")
      .getOrElse(q"TRUE")

    for {
      accessQuery <- accessQueryFromAccessQ(listAccessQ)
      query = q"""SELECT $columns
                  FROM webknossos.tasks_
                  WHERE _id IN (
                    SELECT DISTINCT t._id
                    FROM webknossos.tasks_ t
                    $userJoin
                    WHERE $projectFilter
                    AND $taskTypeFilter
                    AND $taskIdsFilter
                    AND $userFilter
                    AND $accessQuery
                  )
                  $orderRandom
                  LIMIT 1000
                  OFFSET ${pageNumber * 1000}"""
      r <- run(query.as[TasksRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed
  }

  def countPendingInstancesAndTimeForProject(projectId: ObjectId): Fox[(Long, Long)] =
    for {
      result <- run(q"""SELECT SUM(pendingInstances), SUM(tracingtime)
                        FROM webknossos.tasks_
                        WHERE _project = $projectId
                        GROUP BY _project""".as[(Long, Option[Long])])
      firstResult <- result.headOption.toFox
    } yield (firstResult._1, firstResult._2.getOrElse(0L))

  def countPendingInstancesAndTimeByProject: Fox[Map[ObjectId, (Long, Long)]] =
    for {
      rowsRaw <- run(q"""SELECT _project, SUM(pendingInstances), SUM(tracingtime)
                         FROM webknossos.tasks_
                         GROUP BY _project""".as[(String, Long, Option[Long])])
    } yield rowsRaw.toList.map(r => (ObjectId(r._1), (r._2, r._3.getOrElse(0L)))).toMap

  def listExperienceDomains(organizationId: String): Fox[List[String]] =
    for {
      rowsRaw <- run(
        q"SELECT domain FROM webknossos.experienceDomains WHERE _organization = $organizationId".as[String])
    } yield rowsRaw.toList

  def findTaskBoundingBoxesByAnnotationIds(annotationIds: Seq[ObjectId]): Fox[Seq[NamedBoundingBox]] =
    for {
      rowsRaw <- run(q"""SELECT t.boundingBox, t._id, a._id
                         FROM webknossos.tasks_ t
                         JOIN webknossos.annotations_ a on a._task = t._id
                         WHERE a._id IN ${SqlToken.tupleFromList(annotationIds)}
                         AND t.boundingBox IS NOT NULL
                         ORDER BY t._id
                         """.as[(String, ObjectId, ObjectId)])
      namedBboxes = rowsRaw.flatMap {
        case (bboxLiteral, taskId, annotationId) =>
          parseBboxOpt(Some(bboxLiteral)).map(bbox =>
            NamedBoundingBox(0, Some(s"Task bounding box of instance $annotationId of task $taskId"), None, None, bbox))
      }
    } yield namedBboxes

  def insertOne(t: Task): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.tasks(_id, _project, _script, _taskType,
                                         neededExperience_domain, neededExperience_value,
                                         totalInstances, pendingInstances, tracingTime, boundingBox,
                                         editPosition, editRotation, creationInfo,
                                         created, isDeleted)
                   VALUES(${t._id}, ${t._project}, ${t._script}, ${t._taskType},
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
        q"""UPDATE webknossos.tasks
            SET totalInstances = totalInstances + $delta
            WHERE _project = $projectId
            AND $accessQuery""".asUpdate.withTransactionIsolation(Serializable),
        retryCount = 50,
        retryIfErrorContains = List(transactionSerializationError)
      )
    } yield ()

  def removeScriptFromAllTasks(scriptId: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"UPDATE webknossos.tasks SET _script = NULL WHERE _script = $scriptId".asUpdate)
    } yield ()

  def logTime(id: ObjectId, time: FiniteDuration)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q"""UPDATE webknossos.tasks
                   SET tracingTime = COALESCE(tracingTime, 0) + ${time.toMillis}
                   WHERE _id = $id""".asUpdate)
    } yield ()

  def removeOneAndItsAnnotations(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val queries = List(
      q"UPDATE webknossos.tasks SET isDeleted = TRUE WHERE _id = $id".asUpdate,
      q"UPDATE webknossos.annotations SET isDeleted = TRUE WHERE _task = $id".asUpdate
    )
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(DBIO.sequence(queries).transactionally)
    } yield ()
  }

  def removeAllWithTaskTypeAndItsAnnotations(taskTypeId: ObjectId): Fox[Unit] = {
    val queries = List(
      q"UPDATE webknossos.tasks SET isDeleted = TRUE WHERE _taskType = $taskTypeId".asUpdate,
      q"""UPDATE webknossos.annotations
          SET isDeleted = TRUE
          WHERE _task IN (
            SELECT _id FROM webknossos.tasks WHERE _taskType = $taskTypeId
          )""".asUpdate
    )
    for {
      _ <- run(DBIO.sequence(queries).transactionally)
    } yield ()
  }

  def removeAllWithProjectAndItsAnnotations(projectId: ObjectId): Fox[Unit] = {
    val queries = List(
      q"UPDATE webknossos.tasks SET isDeleted = TRUE WHERE _project = $projectId".asUpdate,
      q"""UPDATE webknossos.annotations
          SET isDeleted = true
          WHERE _task in (
            SELECT _id
            FROM webknossos.tasks
            WHERE _project = $projectId
          )""".asUpdate
    )
    for {
      _ <- run(DBIO.sequence(queries).transactionally)
    } yield ()
  }

}
