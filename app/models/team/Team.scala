package models.team

import play.api.libs.json._
import reactivemongo.bson.BSONObjectID
import play.modules.reactivemongo.json.BSONFormats._
import com.scalableminds.util.reactivemongo.{DBAccessContext}
import models.basics.SecuredBaseDAO
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.user.{UserDAO, UserService, User}
import play.api.libs.functional.syntax._
import play.api.data.validation.ValidationError
import scala.util.{Failure, Success}
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._

case class Team(name: String, parent: Option[String], roles: List[Role], owner: Option[BSONObjectID] = None, _id: BSONObjectID = BSONObjectID.generate) {

  lazy val id = _id.stringify

  def isEditableBy(user: User) =
    user.adminTeamNames.contains(name) || (parent.map(user.adminTeamNames.contains) getOrElse false)

  def couldBeAdministratedBy(user: User) =
    parent.map(user.teamNames.contains) getOrElse true

  def isRootTeam =
    parent.isEmpty
}

object Team extends FoxImplicits {

  val teamFormat = Json.format[Team]

  def teamPublicWrites(team: Team, requestingUser: User)(implicit ctx: DBAccessContext): Future[JsObject] =
    for {
      owner <- team.owner.toFox.flatMap(UserDAO.findOneById(_).map(User.userCompactWrites(requestingUser).writes(_))).futureBox
    } yield {
      Json.obj(
        "id" -> team.id,
        "name" -> team.name,
        "roles" -> team.roles,
        "owner" -> owner.toOption,
        "amIAnAdmin" -> requestingUser.adminTeamNames.contains(team.name),
        "isEditable" -> team.isEditableBy(requestingUser)
      )
    }

  def teamPublicReads(requestingUser: User): Reads[Team] =
    ((__ \ "name").read[String](Reads.minLength[String](3)) and
      (__ \ "roles").read[List[Role]] and
      (__ \ "parent").readNullable(Reads.minLength[String](3))
      )((name, roles, parent) => Team(name, parent, roles, Some(requestingUser._id)))
}

object TeamService {
  def create(team: Team, user: User)(implicit ctx: DBAccessContext) = {
    UserDAO.addTeams(user._id, Seq(TeamMembership(team.name, Role.Admin)))
    TeamDAO.insert(team)
  }

  def remove(team: Team)(implicit ctx: DBAccessContext) = {
    TeamDAO.removeById(team._id)
  }
}

object TeamDAO extends SecuredBaseDAO[Team] with FoxImplicits {
  val collectionName = "teams"

  implicit val formatter = Team.teamFormat

  def findOneByName(name: String)(implicit ctx: DBAccessContext) =
    findOne("name", name)
}
