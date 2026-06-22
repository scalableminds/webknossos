package models.team

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import play.api.libs.functional.syntax.toFunctionalBuilderOps
import play.api.libs.json.{JsObject, Json, Reads, __}

import javax.inject.Inject

case class TeamMembership(teamId: ObjectId, isTeamManager: Boolean)
object TeamMembership {
  implicit val jsonReads: Reads[TeamMembership] = {
    ((__ \ "id").read[ObjectId] and
      (__ \ "isTeamManager").read[Boolean])((id, isTeamManager) => TeamMembership(id, isTeamManager))
  }
}

class TeamMembershipService @Inject()(teamDAO: TeamDAO) {
  def publicWrites(teamMembership: TeamMembership)(using ctx: DBAccessContext): Fox[JsObject] =
    for {
      team <- teamDAO.findOne(teamMembership.teamId)
    } yield
      Json.obj(
        "id" -> teamMembership.teamId,
        "name" -> team.name,
        "isTeamManager" -> teamMembership.isTeamManager
      )
}
