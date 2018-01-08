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
                 organization: BSONObjectID,
                 _id: BSONObjectID = BSONObjectID.generate) {

  lazy val id = _id.stringify

  def isEditableBy(user: User) =
    user.organization == organization && (user.isSuperVisorOf(name) || user.isAdmin)

  def couldBeAdministratedBy(user: User) =
    user.organization == organization
}

object Team extends FoxImplicits {

  val teamFormat = Json.format[Team]

  def teamPublicWrites(team: Team, requestingUser: User)(implicit ctx: DBAccessContext): Future[JsObject] =
    for {
      org <- OrganizationDAO.findOneById(team.organization).map(_.name).futureBox
    } yield {
      Json.obj(
        "id" -> team.id,
        "name" -> team.name,
        "organization" -> org.toOption
      )
    }

  def teamPublicWritesBasic(team: Team)(implicit ctx: DBAccessContext): Future[JsObject] =
    for {
      org <- OrganizationDAO.findOneById(team.organization).map(_.name).futureBox
    } yield {
      Json.obj(
        "id" -> team.id,
        "name" -> team.name,
        "organization" -> org.toOption
      )
    }

  def teamPublicReads(requestingUser: User): Reads[Team] =
    ((__ \ "name").read[String](Reads.minLength[String](3)) and
      (__ \ "organization").read[BSONObjectID]
      ) ((name, organization) => Team(name, organization))
}

object TeamService {
  def create(team: Team, user: User)(implicit ctx: DBAccessContext) = {
    UserDAO.addTeam(user._id, TeamMembership(team.name, true))
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
          AllowIf(Json.obj("name" -> Json.obj("$in" -> user.teamNames)))
        case _ =>
          DenyEveryone()
      }
    }
  }

  def findOneByName(name: String)(implicit ctx: DBAccessContext) =
    findOne("name", name)
}
