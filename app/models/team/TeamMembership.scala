package models.team

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox

import javax.inject.Inject
import play.api.libs.functional.syntax._
import play.api.libs.json._

case class TeamMembership(teamId: ObjectId, isTeamManager: Boolean)

class TeamMembershipService @Inject() (teamDAO: TeamDAO) {
  def publicWrites(teamMembership: TeamMembership)(implicit ctx: DBAccessContext): Fox[JsObject] =
    for {
      team <- teamDAO.findOne(teamMembership.teamId)
    } yield Json.obj(
      "id" -> teamMembership.teamId,
      "name" -> team.name,
      "isTeamManager" -> teamMembership.isTeamManager
    )

  def publicReads(): Reads[TeamMembership] =
    ((__ \ "id").read[ObjectId] and
      (__ \ "isTeamManager").read[Boolean])((id, isTeamManager) => TeamMembership(id, isTeamManager))
}
