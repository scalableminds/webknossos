package models.team

import com.scalableminds.util.reactivemongo.{DBAccessContext, JsonFormatHelper, GlobalAccessContext}
import play.api.libs.json._
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONObjectIDFormat
import play.api.libs.functional.syntax._
import models.team.TeamDAO

import scala.concurrent.Future
import com.scalableminds.util.tools.Fox

/**
  * Company: scalableminds
  * User: tmbo
  * Date: 14.07.13
  * Time: 16:49
  */
case class TeamMembership(_id: BSONObjectID = BSONObjectID.generate, isSuperVisor: Boolean) {

  override def toString =
    if (isSuperVisor)
      s"supervisor - ${_id}"
    else
      s"user - ${_id}"
}

object TeamMembership {

  val Member = "Member"
  val Admin = "Admin"

  implicit val teamMembershipFormat = Json.format[TeamMembership]

  def teamMembershipPublicWrites(teamMembership: TeamMembership): Fox[JsObject] =
    for {
      team <- TeamDAO.findOneById(teamMembership._id)(GlobalAccessContext)
    } yield {
        Json.obj(
          "id" -> teamMembership._id.stringify,
          "isSuperVisor" -> teamMembership.isSuperVisor,
          "name" -> team.name
        )
    }

  def teamMembershipPublicReads(): Reads[TeamMembership] =
    ((__ \ "id").read[String](JsonFormatHelper.StringObjectIdReads("id")) and
      (__ \ "isSuperVisor").read[Boolean]
      ) ((id, isSuperVisor) => TeamMembership(BSONObjectID(id), isSuperVisor))
}
