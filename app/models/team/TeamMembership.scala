package models.team

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.Fox
import javax.inject.Inject
import play.api.libs.functional.syntax._
import play.api.libs.json._
import utils.ObjectId

case class TeamMembership(teamId: ObjectId, isTeamManager: Boolean)

class TeamMembershipService @Inject()(teamDAO: TeamDAO) {
  def publicWrites(teamMembership: TeamMembership)(implicit ctx: DBAccessContext): Fox[JsObject] =
    for {
      team <- teamDAO.findOne(teamMembership.teamId)
    } yield {
      Json.obj(
        "id" -> teamMembership.teamId.toString,
        "name" -> team.name,
        "isTeamManager" -> teamMembership.isTeamManager
      )
    }

  def publicReads(): Reads[TeamMembership] =
    ((__ \ "id").read[String](ObjectId.stringObjectIdReads("id")) and
      (__ \ "isTeamManager").read[Boolean])((id, isTeamManager) => TeamMembership(ObjectId(id), isTeamManager))
}
