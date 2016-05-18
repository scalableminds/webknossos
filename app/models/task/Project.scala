package models.task

import models.basics._
import models.user.{UserDAO, UserService, User}
import play.api.libs.json._
import play.api.libs.json.Json
import play.api.libs.functional.syntax._
import com.scalableminds.util.reactivemongo.{DefaultAccessDefinitions, GlobalAccessContext, DBAccessContext}
import reactivemongo.bson.BSONObjectID
import play.modules.reactivemongo.json.BSONFormats._
import com.scalableminds.util.tools.{FoxImplicits, Fox}
import scala.concurrent.Future
import net.liftweb.common.Full
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.api.indexes.{IndexType, Index}
import models.team.Role
import play.api.Logger
import net.liftweb.common.{Full, Empty}
import com.scalableminds.util.reactivemongo.AccessRestrictions.{DenyEveryone, AllowIf}
import play.api.i18n.Messages
import play.api.data.validation.ValidationError

case class Project(name: String, team: String, _owner: BSONObjectID, _id: BSONObjectID = BSONObjectID.generate) {
  def owner = UserService.findOneById(_owner.stringify, useCache = true)(GlobalAccessContext)

  def isOwnedBy(user: User) = user._id == _owner

  def id = _id.stringify

  def tasks(implicit ctx: DBAccessContext) = TaskDAO.findAllByProject(name)(GlobalAccessContext)
}

object Project {
  implicit val projectFormat = Json.format[Project]

  def StringObjectIdReads(key: String) = Reads.filter[String](ValidationError("objectid.invalid", key))(BSONObjectID.parse(_).isSuccess)

  def projectPublicWrites(project: Project, requestingUser: User): Future[JsObject] =
    for{
      owner <- project.owner.map(User.userCompactWrites(requestingUser).writes).futureBox
    } yield {
      Json.obj(
        "name" -> project.name,
        "team" -> project.team,
        "owner" -> owner.toOption,
        "id" -> project.id
      )
    }

  def projectPublicWritesWithStatus(project: Project, requestingUser: User)(implicit ctx: DBAccessContext): Future[JsObject] =
    for {
      open <- OpenAssignmentDAO.countForProject(project.name) getOrElse -1
      projectJson <- projectPublicWrites(project, requestingUser)
    } yield {
      projectJson + ("numberOfOpenAssignments" -> JsNumber(open))
    }

  val projectPublicReads: Reads[Project] =
    ((__ \ 'name).read[String](Reads.minLength[String](3) keepAnd Reads.pattern("^[a-zA-Z0-9_-]*$".r, "project.name.invalidChars")) and
      (__ \ 'team).read[String] and
      (__ \ 'owner).read[String](StringObjectIdReads("owner")))((name, team, owner) => Project(name, team, BSONObjectID(owner)))
}

object ProjectService extends FoxImplicits {
  def remove(project: Project)(implicit ctx: DBAccessContext): Fox[Boolean] = {
    ProjectDAO.remove("name", project.name).flatMap{
      case result if result.n > 0 =>
        TaskService.removeAllWithProject(project)
      case _ =>
        Logger.warn("Tried to remove project without permission.")
        Fox.successful(false)
    }
  }

  def insert(name: String, team: String, owner: User)(implicit ctx: DBAccessContext) =
    ProjectDAO.insert(Project(name, team, owner._id))

  def findIfNotEmpty(name: Option[String])(implicit ctx: DBAccessContext): Fox[Option[Project]] = {
    name match {
      case Some("") | None =>
        new Fox(Future.successful(Full(None)))
      case Some(x) =>
        ProjectDAO.findOneByName(x).toFox.map(p => Some(p))
    }
  }
}

object ProjectDAO extends SecuredBaseDAO[Project] {

  override val AccessDefinitions = new DefaultAccessDefinitions{
    override def findQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match{
        case Some(user: User) =>
          AllowIf(Json.obj("team" -> Json.obj("$in" -> user.teamNames)))
        case _ =>
          DenyEveryone()
      }
    }

    override def removeQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match{
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
}
