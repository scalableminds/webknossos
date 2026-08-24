package models.project

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.box.Full
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.schema.Tables.{Projects, ProjectsRow, GetResultProjectsRow}
import com.typesafe.scalalogging.LazyLogging
import models.annotation.{AnnotationState, AnnotationType}
import models.task.TaskDAO
import models.team.TeamDAO
import models.user.{User, UserService}
import play.api.libs.json.*
import com.scalableminds.util.objectid.ObjectId
import utils.sql.{SQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import utils.sql.SqlToken

case class Project(
    _id: ObjectId,
    _team: ObjectId,
    _owner: ObjectId,
    name: String,
    priority: Long,
    paused: Boolean,
    expectedTime: Option[Long],
    isBlacklistedFromReport: Boolean,
    created: Instant = Instant.now,
    isDeleted: Boolean = false
) {

  def isDeletableBy(user: User): Boolean = user._id == _owner || user.isAdmin

}

class ProjectDAO @Inject() (sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[Project, ProjectsRow, Projects](sqlClient) {
  protected val collection = Projects
  protected def resultConverter = GetResultProjectsRow

  protected def parse(r: ProjectsRow): Fox[Project] =
    Fox.successful(
      Project(
        ObjectId(r._id),
        ObjectId(r._team),
        ObjectId(r._owner),
        r.name,
        r.priority,
        r.paused,
        r.expectedtime,
        r.isblacklistedfromreport,
        Instant.fromSql(r.created),
        r.isdeleted
      )
    )

  override protected def readAccessQ(requestingUserId: ObjectId): SqlToken =
    q"""(_team IN (SELECT _team FROM webknossos.user_team_roles WHERE _user = $requestingUserId))
        OR _owner = $requestingUserId
        OR _organization = (SELECT _organization FROM webknossos.users_ WHERE _id = $requestingUserId AND isAdmin)"""
  override protected def deleteAccessQ(requestingUserId: ObjectId): SqlToken = q"_owner = $requestingUserId"

  // read operations

  override def findAll(using ctx: DBAccessContext): Fox[List[Project]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE $accessQuery ORDER BY created".as[ProjectsRow])
      parsed <- parseAll(r)
    } yield parsed

  // Does not use access query (because they dont support prefixes). Use only after separate access check!
  def findAllWithTaskType(taskTypeId: String): Fox[List[Project]] =
    for {
      r <- run(
        q"""SELECT DISTINCT ${columnsWithPrefix("p.")}
            FROM webknossos.projects_ p
            JOIN webknossos.tasks_ t ON t._project = p._id
            JOIN webknossos.taskTypes_ tt ON t._taskType = tt._id
            WHERE tt._id = $taskTypeId
           """.as[ProjectsRow]
      )
      parsed <- parseAll(r)
    } yield parsed

  def findOneByNameAndOrganization(name: String, organizationId: String)(using ctx: DBAccessContext): Fox[Project] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"""SELECT $columns FROM $existingCollectionName
                   WHERE name = $name
                   AND _organization = $organizationId
                   AND $accessQuery""".as[ProjectsRow])
      parsed <- parseFirst(r, s"$organizationId/$name")
    } yield parsed

  def findUsersWithActiveTasks(projectId: ObjectId): Fox[List[(String, String, String, Int)]] =
    for {
      rSeq <- run(q"""SELECT m.email, m.firstName, m.lastName, count(a._id)
                      FROM webknossos.annotations_ a
                      JOIN webknossos.tasks_ t ON a._task = t._id
                      JOIN webknossos.projects_ p ON t._project = p._id
                      JOIN webknossos.users_ u ON a._user = u._id
                      JOIN webknossos.multiusers_ m ON u._multiUser = m._id
                      WHERE p._id = $projectId
                      AND a.state = ${AnnotationState.Active}
                      AND a.typ = ${AnnotationType.Task}
                      GROUP BY m.email, m.firstName, m.lastName
                     """.as[(String, String, String, Int)])
    } yield rSeq.toList

  // write operations

  def insertOne(p: Project, organizationId: String): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.projects(
                                     _id, _organization, _team, _owner, name, priority,
                                     paused, expectedTime, isblacklistedfromreport, created, isDeleted)
                         VALUES(${p._id}, $organizationId, ${p._team}, ${p._owner}, ${p.name}, ${p.priority},
                         ${p.paused}, ${p.expectedTime}, ${p.isBlacklistedFromReport},
                         ${p.created}, ${p.isDeleted})""".asUpdate)
    } yield ()

  def updateOne(p: Project)(using ctx: DBAccessContext): Fox[Unit] =
    for { // note that p.created is immutable, hence skipped here
      _ <- assertUpdateAccess(p._id)
      _ <- run(q"""UPDATE webknossos.projects
                   SET
                     _team = ${p._team},
                     _owner = ${p._owner},
                     name = ${p.name},
                     priority = ${p.priority},
                     paused = ${p.paused},
                     expectedTime = ${p.expectedTime},
                     isblacklistedfromreport = ${p.isBlacklistedFromReport},
                     isDeleted = ${p.isDeleted}
                   WHERE _id = ${p._id}""".asUpdate)
    } yield ()

  def updatePaused(id: ObjectId, isPaused: Boolean)(using ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q"UPDATE webknossos.projects SET paused = $isPaused WHERE _id = $id".asUpdate)
    } yield ()

  def countForTeam(teamId: ObjectId): Fox[Int] =
    for {
      countList <- run(q"SELECT count(*) FROM $existingCollectionName WHERE _team = $teamId".as[Int])
      count <- countList.headOption.toFox
    } yield count

  override def deleteOne(projectId: ObjectId)(using ctx: DBAccessContext): Fox[Unit] =
    deleteOneWithNameSuffix(projectId)
}

class ProjectService @Inject() (projectDAO: ProjectDAO, teamDAO: TeamDAO, userService: UserService, taskDAO: TaskDAO)(
    implicit ec: ExecutionContext
) extends LazyLogging {

  def validateProjectName(name: String): Fox[Unit] =
    for {
      _ <- Fox.fromBool(name.length >= 3) ?~> Msg.Project.nameTooShort
      _ <- Fox.fromBool(name.matches("^[a-zA-Z0-9_-]*$")) ?~> Msg.Project.nameInvalidChars(name)
    } yield ()

  def deleteOne(projectId: ObjectId)(using ctx: DBAccessContext): Fox[Boolean] =
    for {
      removalSuccessBox <- projectDAO.deleteOne(projectId).shiftBox
      successBool <- removalSuccessBox match {
        case Full(_) =>
          for {
            _ <- taskDAO.removeAllWithProjectAndItsAnnotations(projectId)
            _ = logger.info(s"Project $projectId was deleted.")
          } yield true
        case _ =>
          logger.warn(s"Tried to remove project $projectId without permission.")
          Fox.successful(false)
      }
    } yield successBool

  def publicWrites(project: Project)(using ctx: DBAccessContext): Fox[JsObject] =
    for {
      ownerBox <- userService.findOneCached(project._owner).flatMap(u => userService.compactWrites(u)).shiftBox
      teamNameBox <- teamDAO.findOne(project._team)(using GlobalAccessContext).map(_.name).shiftBox
    } yield Json.obj(
      "name" -> project.name,
      "team" -> project._team.toString,
      "teamName" -> teamNameBox.toOption,
      "owner" -> ownerBox.toOption,
      "priority" -> project.priority,
      "paused" -> project.paused,
      "expectedTime" -> project.expectedTime,
      "isBlacklistedFromReport" -> project.isBlacklistedFromReport,
      "id" -> project._id.toString,
      "created" -> project.created
    )

  def publicWritesWithStatus(project: Project, pendingInstances: Long, tracingTime: Long)(using
      ctx: DBAccessContext
  ): Fox[JsObject] =
    for {
      projectJson <- publicWrites(project)
    } yield projectJson ++ Json.obj("pendingInstances" -> JsNumber(pendingInstances), "tracingTime" -> tracingTime)

}
