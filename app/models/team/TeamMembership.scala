package models.team

import play.api.libs.json._
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONObjectIDFormat

/**
  * Company: scalableminds
  * User: tmbo
  * Date: 14.07.13
  * Time: 16:49
  */
case class TeamMembership(team: BSONObjectID, isSuperVisor: Boolean) {

  override def toString =
    if (isSuperVisor)
      s"supervisor - $team"
    else
      s"user - $team"
}

object TeamMembership {

  val Member = "Member"
  val Admin = "Admin"

  implicit object teamMembershipFormat extends Format[TeamMembership] {
    override def reads(json: JsValue): JsResult[TeamMembership] = {
      for {
        team <- json.validate((JsPath \ "team").read[String])
        isSuperVisor <- json.validate((JsPath \ "isSuperVisor").read[Boolean])
      } yield {
        TeamMembership(BSONObjectID(team), isSuperVisor)
      }
    }

    override def writes(teamMembership: TeamMembership): JsValue = {
      Json.obj("team" -> teamMembership.team.stringify, "isSuperVisor" -> teamMembership.isSuperVisor)
    }
  }

}
