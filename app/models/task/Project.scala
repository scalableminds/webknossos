package models.task

import models.basics._
import models.user.{UserService, User}
import play.api.libs.json.{JsArray, Json}
import braingames.reactivemongo.{GlobalAccessContext, DBAccessContext}
import reactivemongo.bson.BSONObjectID
import play.modules.reactivemongo.json.BSONFormats._
import braingames.util.{FoxImplicits, Fox}
import scala.concurrent.Future
import net.liftweb.common.Full
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.api.indexes.{IndexType, Index}
import models.team.Role

case class Project(name: String, team: String, _owner: BSONObjectID) {
  def owner = UserService.findOneById(_owner.stringify, useCache = true)(GlobalAccessContext)

  def tasks(implicit ctx: DBAccessContext) = TaskDAO.findAllByProject(name)(GlobalAccessContext)
}

object Project {
  implicit val projectFormat = Json.format[Project]
}

object ProjectService extends FoxImplicits {
  def remove(project: Project)(implicit ctx: DBAccessContext) =
    ProjectDAO.remove("name", project.name)

  def insert(name: String, team: String, owner: User)(implicit ctx: DBAccessContext) =
    ProjectDAO.insert(Project(name, team, owner._id))

  def findIfNotEmpty(name: String)(implicit ctx: DBAccessContext): Fox[Option[Project]] = {
    name match {
      case "" => new Fox(Future.successful(Full(None)))
      case x => ProjectDAO.findOneByName(x).toFox.map(p => Some(p))
    }
  }
}

object ProjectDAO extends SecuredBaseDAO[Project] {

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
        AllowIf(Json.obj("team" -> Json.obj("$in" -> user.adminTeamNames)))
      case _ =>
        DenyEveryone()
    }
  }

  val collectionName = "projects"

  val formatter = Project.projectFormat

  collection.indexesManager.ensure(Index(Seq("name" -> IndexType.Ascending)))

  def findOneByName(name: String)(implicit ctx: DBAccessContext) = {
    findOne("name", name)
  }
}