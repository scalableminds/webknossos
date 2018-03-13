package models.team

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.Fox
import play.api.libs.json.Json
import utils.ObjectId


case class TeamMembershipSQL(teamId: ObjectId, role: Role)
object TeamMembershipSQL {
  def fromTeamMembership(t: TeamMembership)(implicit ctx: DBAccessContext): Fox[TeamMembershipSQL] = {
    for {
      team <- TeamSQLDAO.findOneByName(t.team)
    } yield {
      TeamMembershipSQL(team._id, t.role)
    }
  }
}

case class TeamMembership(team: String, role: Role){

  override def toString =
    s"${role.name} - $team"
}

object TeamMembership{

  val Member = "Member"
  val Admin = "Admin"

  implicit val teamMembershipFormat = Json.format[TeamMembership]

  def fromTeamMembershipSQL(t: TeamMembershipSQL)(implicit ctx: DBAccessContext): Fox[TeamMembership] = {
    for {
      team <- TeamSQLDAO.findOne(t.teamId)
    } yield {
      TeamMembership(team.name, t.role)
    }
  }
}
