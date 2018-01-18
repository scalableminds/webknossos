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

  implicit object teamMembershipFormat extends Format[TeamMembership] {
    override def reads(json: JsValue): JsResult[TeamMembership] = {
      for {
        _id <- json.validate((JsPath \ "id").read[String])
        isSuperVisor <- json.validate((JsPath \ "isSuperVisor").read[Boolean])
      } yield {
        TeamMembership(BSONObjectID(_id), isSuperVisor)
      }
    }

    override def writes(teamMembership: TeamMembership): JsValue = {
      Json.obj(
        "id" -> teamMembership._id.stringify,
        "isSuperVisor" -> teamMembership.isSuperVisor
      )
    }
  }

}
