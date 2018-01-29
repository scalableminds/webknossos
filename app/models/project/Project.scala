package models.project

import com.scalableminds.util.reactivemongo.AccessRestrictions.{AllowIf, DenyEveryone}
import com.scalableminds.util.reactivemongo.{DBAccessContext, DefaultAccessDefinitions, GlobalAccessContext, JsonFormatHelper}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import models.basics._
import models.task.{TaskDAO, TaskService}
import models.user.{User, UserService}
import net.liftweb.common.Full
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json.{Json, _}
import reactivemongo.api.indexes.{Index, IndexType}
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._

import scala.concurrent.Future

case class Project(
                    name: String,
                    _team: BSONObjectID,
                    _owner: BSONObjectID,
                    priority: Int,
                    paused: Boolean,
                    expectedTime: Option[Int],
                    _id: BSONObjectID = BSONObjectID.generate) {

  def owner = UserService.findOneById(_owner.stringify, useCache = true)(GlobalAccessContext)

  def isOwnedBy(user: User) = user._id == _owner

  def id = _id.stringify

  def tasks(implicit ctx: DBAccessContext) = TaskDAO.findAllByProject(name)(GlobalAccessContext)
}

object Project {
  implicit val projectFormat = Json.format[Project]

  def projectPublicWrites(project: Project, requestingUser: User): Future[JsObject] =
    for {
      owner <- project.owner.map(User.userCompactWrites.writes).futureBox
    } yield {
      Json.obj(
        "name" -> project.name,
        "team" -> project._team,
        "owner" -> owner.toOption,
        "priority" -> project.priority,
        "paused" -> project.paused,
        "expectedTime" -> project.expectedTime,
        "id" -> project.id
      )
    }

  def projectPublicWritesWithStatus(
                                     project: Project,
                                     openTaskInstances: Int,
                                     requestingUser: User)(implicit ctx: DBAccessContext): Future[JsObject] = {

    for {
      projectJson <- projectPublicWrites(project, requestingUser)
    } yield {
      projectJson + ("numberOfOpenAssignments" -> JsNumber(openTaskInstances))
    }
  }

  private val validateProjectName = Reads.pattern("^[a-zA-Z0-9_-]*$".r, "project.name.invalidChars")

  val projectPublicReads: Reads[Project] =
    ((__ \ 'name).read[String](Reads.minLength[String](3) keepAnd validateProjectName) and
      (__ \ 'team).read[String](JsonFormatHelper.StringObjectIdReads("team")) and
      (__ \ 'priority).read[Int] and
      (__ \ 'paused).readNullable[Boolean] and
      (__ \ 'expectedTime).readNullable[Int] and
      (__ \ 'owner).read[String](JsonFormatHelper.StringObjectIdReads("owner"))) (
      (name, team, priority, paused, expectedTime, owner) =>
        Project(name, BSONObjectID(team), BSONObjectID(owner), priority, paused getOrElse false, expectedTime))
}

object ProjectService extends FoxImplicits with LazyLogging {
  def remove(project: Project)(implicit ctx: DBAccessContext): Fox[Boolean] = {
    ProjectDAO.remove("name", project.name).flatMap {
      case result if result.n > 0 =>
        for {
          _ <- TaskService.removeAllWithProject(project)
        } yield true
      case _ =>
        logger.warn("Tried to remove project without permission.")
        Fox.successful(false)
    }
  }

  def findIfNotEmpty(name: Option[String])(implicit ctx: DBAccessContext): Fox[Option[Project]] = {
    name match {
      case Some("") | None =>
        new Fox(Future.successful(Full(None)))
      case Some(x) =>
        ProjectDAO.findOneByName(x).toFox.map(p => Some(p))
    }
  }

  def update(_id: BSONObjectID, oldProject: Project, updateRequest: Project)(implicit ctx: DBAccessContext) = {
    def updateTasksIfNecessary(updated: Project) = {
      if (oldProject.priority == updated.priority)
        Fox.successful(true)
      else
        TaskService.handleProjectUpdate(updated)
    }

    for {
      updatedProject <- ProjectDAO.updateProject(_id, updateRequest)
      _ <- updateTasksIfNecessary(updatedProject)
    } yield updatedProject

  }

  def updatePauseStatus(project: Project, isPaused: Boolean)(implicit ctx: DBAccessContext) = {
    def updateTasksIfNecessary(updated: Project) = {
      if (updated.paused == project.paused)
        Fox.successful(true)
      else
        TaskService.handleProjectUpdate(updated)
    }

    val updated = project.copy(paused = isPaused)

    for {
      updatedProject <- ProjectDAO.updatePausedFlag(updated._id, updated.paused)
      _ <- updateTasksIfNecessary(updated)
    } yield updatedProject
  }
}

object ProjectDAO extends SecuredBaseDAO[Project] {

  override val AccessDefinitions = new DefaultAccessDefinitions {
    override def findQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match {
        case Some(user: User) =>
          AllowIf(Json.obj("team" -> Json.obj("$in" -> user.teamIds)))
        case _ =>
          DenyEveryone()
      }
    }

    override def removeQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match {
        case Some(user: User) =>
          AllowIf(Json.obj("_owner" -> user._id))
        case _ =>
          DenyEveryone()
      }
    }
  }

  val collectionName = "projects"

  val formatter = Project.projectFormat

  underlying.indexesManager.ensure(Index(Seq("name" -> IndexType.Ascending)))
  underlying.indexesManager.ensure(Index(Seq("team" -> IndexType.Ascending)))

  def findOneByName(name: String)(implicit ctx: DBAccessContext) = {
    findOne("name", name)
  }

  def findAllByTeamName(teamName: BSONObjectID)(implicit ctx: DBAccessContext) = withExceptionCatcher {
    find("team", teamName).collect[List]()
  }

  def findAllByTeamNames(teamNames: List[BSONObjectID])(implicit ctx: DBAccessContext) = withExceptionCatcher {
    find(Json.obj("team" -> Json.obj("$in" -> teamNames))).cursor[Project]().collect[List]()
  }

  def updatePausedFlag(_id: BSONObjectID, isPaused: Boolean)(implicit ctx: DBAccessContext) = {
    findAndModify(Json.obj("_id" -> _id), Json.obj("$set" -> Json.obj("paused" -> isPaused)), returnNew = true)
  }

  def updateProject(_id: BSONObjectID, project: Project)(implicit ctx: DBAccessContext) = {
    findAndModify(Json.obj("_id" -> _id), Json.obj("$set" ->
      Json.obj(
        "name" -> project.name,
        "team" -> project._team,
        "_owner" -> project._owner,
        "priority" -> project.priority,
        "expectedTime" -> project.expectedTime,
        "paused" -> project.paused)), returnNew = true)

  }
}
