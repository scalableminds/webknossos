package models.project

import scala.concurrent.Future

import com.scalableminds.util.reactivemongo.AccessRestrictions.{AllowIf, DenyEveryone}
import com.scalableminds.util.reactivemongo.{DBAccessContext, DefaultAccessDefinitions, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.basics._
import models.mturk.{MTurkAssignmentConfig, MTurkProjectDAO}
import models.task.{OpenAssignmentDAO, OpenAssignmentService, TaskDAO, TaskService}
import models.user.{User, UserService}
import net.liftweb.common.Full
import oxalis.mturk.MTurkService
import play.api.Logger
import play.api.data.validation.ValidationError
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json.{Json, _}
import reactivemongo.api.indexes.{Index, IndexType}
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._

case class Project(
  name: String,
  team: String,
  _owner: BSONObjectID,
  priority: Int,
  paused: Boolean,
  assignmentConfiguration: AssignmentConfig,
  _id: BSONObjectID = BSONObjectID.generate) {

  def owner = UserService.findOneById(_owner.stringify, useCache = true)(GlobalAccessContext)

  def isOwnedBy(user: User) = user._id == _owner

  def id = _id.stringify

  def tasks(implicit ctx: DBAccessContext) = TaskDAO.findAllByProject(name)(GlobalAccessContext)
}

object Project {
  implicit val projectFormat = Json.format[Project]

  def StringObjectIdReads(key: String) = Reads.filter[String](ValidationError("objectid.invalid", key))(BSONObjectID.parse(_).isSuccess)

  def projectPublicWrites(project: Project, requestingUser: User): Future[JsObject] =
    for {
      owner <- project.owner.map(User.userCompactWrites.writes).futureBox
    } yield {
      Json.obj(
        "name" -> project.name,
        "team" -> project.team,
        "owner" -> owner.toOption,
        "priority" -> project.priority,
        "paused" -> project.paused,
        "assignmentConfiguration" -> project.assignmentConfiguration,
        "id" -> project.id
      )
    }

  def numberOfOpenAssignments(project: Project)(implicit ctx: DBAccessContext): Fox[Int] = {
    project.assignmentConfiguration match {
      case WebknossosAssignmentConfig =>
        OpenAssignmentDAO.countForProject(project.name)
      case _: MTurkAssignmentConfig =>
        MTurkProjectDAO.findByProject(project.name).map(_.numberOfOpenAssignments)
    }
  }

  def projectPublicWritesWithStatus(project: Project, requestingUser: User)(implicit ctx: DBAccessContext): Future[JsObject] =
    for {
      open <- numberOfOpenAssignments(project) getOrElse -1
      projectJson <- projectPublicWrites(project, requestingUser)
    } yield {
      projectJson + ("numberOfOpenAssignments" -> JsNumber(open))
    }

  val projectPublicReads: Reads[Project] =
    ((__ \ 'name).read[String](Reads.minLength[String](3) keepAnd Reads.pattern("^[a-zA-Z0-9_-]*$".r, "project.name.invalidChars")) and
      (__ \ 'team).read[String] and
      (__ \ 'priority).read[Int] and
      (__ \ 'paused).readNullable[Boolean] and
      (__ \ 'assignmentConfiguration).read[AssignmentConfig] and
      (__ \ 'owner).read[String](StringObjectIdReads("owner"))) (
      (name, team, priority, paused, assignmentLocation, owner) =>
        Project(name, team, BSONObjectID(owner), priority, paused getOrElse false, assignmentLocation))
}

object ProjectService extends FoxImplicits {
  def remove(project: Project)(implicit ctx: DBAccessContext): Fox[Boolean] = {
    ProjectDAO.remove("name", project.name).flatMap {
      case result if result.n > 0 =>
        for{
          _ <- TaskService.removeAllWithProject(project)
        } yield true
      case _                      =>
        Logger.warn("Tried to remove project without permission.")
        Fox.successful(false)
    }
  }

  def reportToExternalService(project: Project, json: JsValue): Fox[Boolean] = {
    project.assignmentConfiguration match {
      case mturk: MTurkAssignmentConfig =>
        MTurkService.handleProjectCreation(project, mturk)
      case _ =>
        Fox.successful(true)
    }
  }

  def findIfNotEmpty(name: Option[String])(implicit ctx: DBAccessContext): Fox[Option[Project]] = {
    name match {
      case Some("") | None =>
        new Fox(Future.successful(Full(None)))
      case Some(x)         =>
        ProjectDAO.findOneByName(x).toFox.map(p => Some(p))
    }
  }

  def update(_id: BSONObjectID, oldProject: Project, updateRequest: Project)(implicit ctx: DBAccessContext) = {
    def updateTasksIfNecessary(updated: Project) = {
      if (oldProject.priority == updated.priority)
        Fox.successful(true)
      else
        TaskService.handleProjectUpdate(oldProject.name, updated)
    }

    for {
      updatedProject <- ProjectDAO.updateProject(_id, updateRequest)
      _ <- updateTasksIfNecessary(updatedProject)
    } yield updatedProject

  }

  def updatePauseStatus(project: Project, isPaused: Boolean)(implicit ctx: DBAccessContext) = {
    def updateTasksIfNecessary(updated: Project) = {
      if(updated.paused == project.paused)
        Fox.successful(true)
      else
        TaskService.handleProjectUpdate(updated.name, updated)
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
          AllowIf(Json.obj("team" -> Json.obj("$in" -> user.teamNames)))
        case _                =>
          DenyEveryone()
      }
    }

    override def removeQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match {
        case Some(user: User) =>
          AllowIf(Json.obj("_owner" -> user._id))
        case _                =>
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

  def updatePausedFlag(_id: BSONObjectID, isPaused: Boolean)(implicit ctx: DBAccessContext) = {
    findAndModify(Json.obj("_id" -> _id), Json.obj("$set" -> Json.obj("paused" -> isPaused)), returnNew = true)
  }

  def updateProject(_id: BSONObjectID, project: Project)(implicit ctx: DBAccessContext) = {
    findAndModify(Json.obj("_id" -> _id), Json.obj("$set" ->
      Json.obj(
        "name" -> project.name,
        "team" -> project.team,
        "_owner" -> project._owner,
        "priority" -> project.priority,
        "paused" -> project.paused)), returnNew = true)

  }
}
