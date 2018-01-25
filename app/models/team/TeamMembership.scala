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
  object TeamMembershipReads extends Reads[List[TeamMembership]] {

  override def reads(json: JsValue): JsResult[List[TeamMembership]] = {
    json.validate(Reads.mapReads(TeamMembership.teamMembershipPublicReads)).map { jso =>
      jso.map {
        case (id, name, isSuperVisor) => TeamMembership(BSONObjectID(id), name, isSuperVisor)
      }.toList
    }
  }
}

case class TeamMembership(_id: BSONObjectID = BSONObjectID.generate, name: String, isSuperVisor: Boolean) {

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

  def teamMembershipPublicWrites(teamMembership: TeamMembership): JsObject =
    Json.obj(
      "id" -> teamMembership._id.stringify,
      "isSuperVisor" -> teamMembership.isSuperVisor,
      "name" -> teamMembership.name
    )

  def teamMembershipPublicReads(): Reads[TeamMembership] =
    ((__ \ "id").read[String](JsonFormatHelper.StringObjectIdReads("id")) and
      (__ \ "name").read[String] and
      (__ \ "isSuperVisor").read[Boolean]
      ) ((id, name, isSuperVisor) => TeamMembership(BSONObjectID(id), name, isSuperVisor))
}
