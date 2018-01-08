package models.team

import play.api.libs.json.Json

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 14.07.13
 * Time: 16:49
 */
case class TeamMembership(team: String, isSuperVisor: Boolean){

  override def toString =
    if(isSuperVisor)
      s"supervisor - $team"
   else
      s"user - $team"
}

object TeamMembership{

  val Member = "Member"
  val Admin = "Admin"

  implicit val teamMembershipFormat = Json.format[TeamMembership]
}
