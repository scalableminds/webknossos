package models.team

import com.scalableminds.util.reactivemongo.AccessRestrictions.{AllowIf, DenyEveryone}
import com.scalableminds.util.reactivemongo.{DBAccessContext, DefaultAccessDefinitions, GlobalAccessContext}
import com.scalableminds.util.tools.FoxImplicits
import models.basics.SecuredBaseDAO
import models.user.{User, UserDAO}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json._
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._

import scala.concurrent.Future

case class Team(
                 name: String,
                 organization: String,
                 _id: BSONObjectID = BSONObjectID.generate) {

  lazy val id = _id.stringify

  def isEditableBy(user: User) =
    user.organization == organization && (user.isSuperVisorOf(_id) || user.isAdmin)

  def couldBeAdministratedBy(user: User) =
    user.organization == organization

  def isAdminOfOrganization(user: User) =
    user.organization == organization && user.isAdmin
}

object Team extends FoxImplicits {

  val teamFormat = Json.format[Team]

  def teamPublicWrites(team: Team)(implicit ctx: DBAccessContext): Future[JsObject] =
    Future.successful(
      Json.obj(
        "id" -> team.id,
        "name" -> team.name,
        "organization" -> team.organization
      )
    )

  def teamPublicReads(requestingUser: User): Reads[Team] =
    ((__ \ "name").read[String](Reads.minLength[String](3)) and
      (__ \ "organization").read[String](Reads.minLength[String](3))
      ) ((name, organization) => Team(name, organization))

  def teamReadsName(): Reads[String] =
    (__ \ "name").read[String]
}

object TeamService {
  def create(team: Team, user: User)(implicit ctx: DBAccessContext) = {
    UserDAO.addTeam(user._id, TeamMembership(team._id, true))
    TeamDAO.insert(team)
  }

  def remove(team: Team)(implicit ctx: DBAccessContext) = {
    TeamDAO.removeById(team._id)
  }
}

object TeamDAO extends SecuredBaseDAO[Team] with FoxImplicits {
  val collectionName = "teams"

  implicit val formatter = Team.teamFormat

  override val AccessDefinitions = new DefaultAccessDefinitions {

    override def findQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match {
        case Some(user: User) =>
          AllowIf(Json.obj("_id" -> Json.obj("$in" -> user.teamIds)))
        case _ =>
          DenyEveryone()
      }
    }
  }

  def findOneByName(name: String)(implicit ctx: DBAccessContext) =
    findOne("name", name)
}
