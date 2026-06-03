package models.team

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import play.api.libs.json.{JsObject, Json, Reads}

import javax.inject.Inject

case class TeamMembership(teamId: ObjectId, isTeamManager: Boolean)
object TeamMembership {
  implicit val jsonReads: Reads[TeamMembership] = Json.reads[TeamMembership]
}

class TeamMembershipService @Inject()(teamDAO: TeamDAO) {
  def publicWrites(teamMembership: TeamMembership)(implicit ctx: DBAccessContext): Fox[JsObject] =
    for {
      team <- teamDAO.findOne(teamMembership.teamId)
    } yield
      Json.obj(
        "id" -> teamMembership.teamId,
        "name" -> team.name,
        "isTeamManager" -> teamMembership.isTeamManager
      )
}
