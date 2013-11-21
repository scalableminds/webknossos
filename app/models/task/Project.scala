package models.task

import models.basics._
import com.novus.salat.annotations._
import models.user.{UserService, User}
import play.api.libs.json.Json
import braingames.reactivemongo.{GlobalAccessContext, DBAccessContext}
import reactivemongo.bson.BSONObjectID
import play.modules.reactivemongo.json.BSONFormats._
import braingames.util.{FoxImplicits, Fox}
import scala.concurrent.Future
import net.liftweb.common.Full
import play.api.libs.concurrent.Execution.Implicits._

case class Project(@Key("name") name: String, _owner: BSONObjectID) {
  def owner = UserService.findOneById(_owner.stringify, useCache = true)

  lazy val tasks = TaskDAO.findAllByProject(name)(GlobalAccessContext)
}

object Project {
  implicit val projectFormat = Json.format[Project]
}

object ProjectService extends FoxImplicits {
  def remove(project: Project)(implicit ctx: DBAccessContext) =
    ProjectDAO.remove("name", project.name)

  def insert(name: String, owner: User)(implicit ctx: DBAccessContext) = {
    ProjectDAO.insert(Project(name, owner._id))
  }

  def findIfNotEmpty(name: String)(implicit ctx: DBAccessContext): Fox[Option[Project]] = {
    name match {
      case "" => new Fox(Future.successful(Full(None)))
      case x => ProjectDAO.findOneByName(x).toFox.map(p => Some(p))
    }
  }
}

object ProjectDAO extends SecuredBaseDAO[Project] {

  val collectionName = "projects"

  val formatter = Project.projectFormat

  def findOneByName(name: String)(implicit ctx: DBAccessContext) = {
    findOne("name", name)
  }
}