package models.team

import com.scalableminds.util.reactivemongo.AccessRestrictions.{AllowIf, DenyEveryone}
import com.scalableminds.util.reactivemongo.{DBAccessContext, DefaultAccessDefinitions, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.basics.SecuredBaseDAO
import models.user.{User, UserDAO}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json._
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._

import scala.concurrent.Future

case class Organization(
                         name: String,
                         teams: List[BSONObjectID],
                         _id: BSONObjectID = BSONObjectID.generate) {

  lazy val id = _id.stringify
}

object Organization extends FoxImplicits {

  val organizationFormat = Json.format[Organization]

  def organizationPublicWrites(organization: Organization, requestingUser: User)(implicit ctx: DBAccessContext): Future[JsObject] =
    for {
      teams <- Fox.combined(organization.teams.map(TeamDAO.findOneById(_).map(_.name))).futureBox
    } yield {
      Json.obj(
        "id" -> organization.id,
        "name" -> organization.name,
        "teams" -> teams.toOption)
    }

  def organizationPublicWritesBasic(organization: Organization)(implicit ctx: DBAccessContext): Future[JsObject] =
    for {
      teams <- Fox.combined(organization.teams.map(TeamDAO.findOneById(_).map(_.name))).futureBox
    } yield {
      Json.obj(
        "id" -> organization.id,
        "name" -> organization.name,
        "teams" -> teams.toOption)
    }

  def organizationsPublicReads(requestingUser: User): Reads[Organization] =
    ((__ \ "name").read[String](Reads.minLength[String](3)) and
      (__ \ "teams").read[List[BSONObjectID]]
      ) ((name, teams) => Organization(name, teams))
}

object OrganizationDAO extends SecuredBaseDAO[Organization] with FoxImplicits {
  val collectionName = "organizations"

  implicit val formatter = Organization.organizationFormat

  override val AccessDefinitions = new DefaultAccessDefinitions {

    override def findQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match {
        case Some(user: User) =>
          AllowIf(Json.obj("_id" -> user.organization))
        case _ =>
          DenyEveryone()
      }
    }
  }
  def findByIdQ(id: BSONObjectID) = Json.obj("_id" -> id)

  def findOneByName(name: String)(implicit ctx: DBAccessContext) =
    findOne("name", name)

  def addTeam(_organization: BSONObjectID, team: Team)(implicit ctx: DBAccessContext) =
    update(findByIdQ(_organization), Json.obj("$push" -> Json.obj("teams" -> team._id)))
}
