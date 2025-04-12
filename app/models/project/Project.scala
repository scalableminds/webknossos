package models.project

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.schema.Tables._
import com.typesafe.scalalogging.LazyLogging
import models.annotation.{AnnotationState, AnnotationType}
import models.task.TaskDAO
import models.team.TeamDAO
import models.user.{User, UserService}
import net.liftweb.common.Full
import play.api.libs.functional.syntax._
import play.api.libs.json._
import slick.lifted.Rep
import com.scalableminds.util.objectid.ObjectId
import utils.sql.{SQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.{ExecutionContext, Future}

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
) extends FoxImplicits {

  def isDeletableBy(user: User): Boolean = user._id == _owner || user.isAdmin

}

object Project {
  private val validateProjectName = Reads.pattern("^[a-zA-Z0-9_-]*$".r, "project.name.invalidChars")

  // format: off
  val projectPublicReads: Reads[Project] =
    ((__ \ "name").read[String](Reads.minLength[String](3) keepAnd validateProjectName) and
      (__ \ "team").read[ObjectId] and
      (__ \ "priority").read[Int] and
      (__ \ "paused").readNullable[Boolean] and
      (__ \ "expectedTime").readNullable[Long] and
      (__ \ "owner").read[ObjectId] and
      (__ \ "isBlacklistedFromReport").read[Boolean]) (
      (name, team, priority, paused, expectedTime, owner, isBlacklistedFromReport) =>
        Project(ObjectId.generate, team, owner, name, priority, paused getOrElse false, expectedTime, isBlacklistedFromReport))
  // format: on

}

class ProjectDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[Project, ProjectsRow, Projects](sqlClient) {
  protected val collection = Projects

  protected def idColumn(x: Projects): Rep[String] = x._Id
  protected def isDeletedColumn(x: Projects): Rep[Boolean] = x.isdeleted

  protected def parse(r: ProjectsRow): Fox[Project] =
    Fox.successful(
      Project(
        ObjectId(r._Id),
        ObjectId(r._Team),
        ObjectId(r._Owner),
        r.name,
        r.priority,
        r.paused,
        r.expectedtime,
        r.isblacklistedfromreport,
        Instant.fromSql(r.created),
        r.isdeleted
      ))

  override protected def readAccessQ(requestingUserId: ObjectId) =
    q"""(_team IN (SELECT _team FROM webknossos.user_team_roles WHERE _user = $requestingUserId))
        OR _owner = $requestingUserId
        OR _organization = (SELECT _organization FROM webknossos.users_ WHERE _id = $requestingUserId AND isAdmin)"""
  override protected def deleteAccessQ(requestingUserId: ObjectId) = q"_owner = $requestingUserId"

  // read operations

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Project] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE _id = $id AND $accessQuery".as[ProjectsRow])
      parsed <- parseFirst(r, id)
    } yield parsed

  override def findAll(implicit ctx: DBAccessContext): Fox[List[Project]] =
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

  def findOneByNameAndOrganization(name: String, organizationId: String)(implicit ctx: DBAccessContext): Fox[Project] =
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
      rSeq <- run(q"""SELECT m.email, u.firstName, u.lastName, count(a._id)
                      FROM webknossos.annotations_ a
                      JOIN webknossos.tasks_ t ON a._task = t._id
                      JOIN webknossos.projects_ p ON t._project = p._id
                      JOIN webknossos.users_ u ON a._user = u._id
                      JOIN webknossos.multiusers_ m ON u._multiUser = m._id
                      WHERE p._id = $projectId
                      AND a.state = ${AnnotationState.Active}
                      AND a.typ = ${AnnotationType.Task}
                      GROUP BY m.email, u.firstName, u.lastName
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

  def updateOne(p: Project)(implicit ctx: DBAccessContext): Fox[Unit] =
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

  def updatePaused(id: ObjectId, isPaused: Boolean)(implicit ctx: DBAccessContext): Fox[Unit] =
    updateBooleanCol(id, _.paused, isPaused)

  def countForTeam(teamId: ObjectId): Fox[Int] =
    for {
      countList <- run(q"SELECT count(*) FROM $existingCollectionName WHERE _team = $teamId".as[Int])
      count <- countList.headOption.toFox
    } yield count

  override def deleteOne(projectId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    deleteOneWithNameSuffix(projectId)
}

class ProjectService @Inject()(projectDAO: ProjectDAO, teamDAO: TeamDAO, userService: UserService, taskDAO: TaskDAO)(
    implicit ec: ExecutionContext)
    extends LazyLogging
    with FoxImplicits {

  def deleteOne(projectId: ObjectId)(implicit ctx: DBAccessContext): Fox[Boolean] = {
    val futureFox: Future[Fox[Boolean]] = for {
      removalSuccessBox <- projectDAO.deleteOne(projectId).futureBox
    } yield {
      removalSuccessBox match {
        case Full(_) =>
          for {
            _ <- taskDAO.removeAllWithProjectAndItsAnnotations(projectId)
            _ = logger.info(s"Project $projectId was deleted.")
          } yield true
        case _ =>
          logger.warn(s"Tried to remove project $projectId without permission.")
          Fox.successful(false)
      }
    }
    Fox.fromFuture(futureFox).flatten
  }

  def publicWrites(project: Project)(implicit ctx: DBAccessContext): Fox[JsObject] =
    for {
      ownerBox <- Fox.fromFuture(
        userService.findOneCached(project._owner).flatMap(u => userService.compactWrites(u)).futureBox)
      teamNameBox <- Fox.fromFuture(teamDAO.findOne(project._team)(GlobalAccessContext).map(_.name).futureBox)
    } yield {
      Json.obj(
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
    }

  def publicWritesWithStatus(project: Project, pendingInstances: Long, tracingTime: Long)(
      implicit ctx: DBAccessContext): Fox[JsObject] =
    for {
      projectJson <- publicWrites(project)
    } yield {
      projectJson ++ Json.obj("pendingInstances" -> JsNumber(pendingInstances), "tracingTime" -> tracingTime)
    }

}
