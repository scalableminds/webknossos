package models.team

import com.scalableminds.util.reactivemongo.AccessRestrictions.{DenyEveryone, AllowIf}
import play.api.libs.json._
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._
import com.scalableminds.util.reactivemongo.{GlobalAccessContext, DefaultAccessDefinitions, DBAccessContext}
import models.basics.SecuredBaseDAO
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.user.{UserDAO, UserService, User}
import play.api.libs.functional.syntax._
import play.api.data.validation.ValidationError
import scala.util.{Failure, Success}
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._

case class Team(name: String, parent: Option[String], roles: List[Role], owner: Option[BSONObjectID] = None, behavesLikeRootTeam: Option[Boolean] = None, _id: BSONObjectID = BSONObjectID.generate) {

  lazy val id = _id.stringify

  def isEditableBy(user: User) =
    user.isAdminOf(name) || parent.exists(user.isAdminOf)

  def isOwner(user: User) =
    owner.contains(user._id)

  def couldBeAdministratedBy(user: User) =
    parent.forall(user.teamNames.contains)

  def isRootTeam =
    behavesLikeRootTeam.getOrElse(parent.isEmpty)
}

object Team extends FoxImplicits {

  val teamFormat = Json.format[Team]

  def teamPublicWrites(team: Team, requestingUser: User)(implicit ctx: DBAccessContext): Future[JsObject] =
    for {
      owner <- team.owner.toFox.flatMap(UserDAO.findOneById(_).map(User.userCompactWrites(requestingUser).writes)).futureBox
    } yield {
      Json.obj(
        "id" -> team.id,
        "name" -> team.name,
        "parent" -> team.parent,
        "roles" -> team.roles,
        "owner" -> owner.toOption,
        "amIAnAdmin" -> requestingUser.isAdminOf(team.name),
        "isEditable" -> team.isEditableBy(requestingUser),
        "amIOwner" -> team.isOwner(requestingUser)
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
    UserDAO.addTeam(user._id, TeamMembership(team.name, Role.Admin))
    TeamDAO.insert(team)
  }

  def remove(team: Team)(implicit ctx: DBAccessContext) = {
    TeamDAO.removeById(team._id)
  }

  def rootTeams() = {
    TeamDAO.findRootTeams()(GlobalAccessContext)
  }
}

object TeamDAO extends SecuredBaseDAO[Team] with FoxImplicits {
  val collectionName = "teams"

  implicit val formatter = Team.teamFormat

  override val AccessDefinitions = new DefaultAccessDefinitions{

    override def findQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match{
        case Some(user: User) =>
          AllowIf(Json.obj(
            "$or" -> Json.arr(
              Json.obj("name" -> Json.obj("$in" -> user.teamNames)),
              Json.obj("parent"-> Json.obj("$in" -> user.teamNames)))
          ))
        case _ =>
          DenyEveryone()
      }
    }
  }

  def findOneByName(name: String)(implicit ctx: DBAccessContext) =
    findOne("name", name)

  def findRootTeams()(implicit ctx: DBAccessContext) = withExceptionCatcher {
    find(Json.obj("$or" -> Json.arr(
      Json.obj("behavesLikeRootTeam" -> true),
      Json.obj("parent" -> Json.obj("$exists" -> false)))
    )).cursor[Team]().collect[List]()
  }
}
