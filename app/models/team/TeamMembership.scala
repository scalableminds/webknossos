package models.team

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.Fox
import play.api.libs.functional.syntax._
import play.api.libs.json._
import utils.ObjectId


case class TeamMembershipSQL(teamId: ObjectId, isTeamManager: Boolean) {
  def publicWrites(implicit ctx: DBAccessContext): Fox[JsObject] = {
    for {
      team <- TeamDAO.findOne(teamId)
    } yield {
      Json.obj(
        "id" -> teamId.toString,
        "name" -> team.name,
        "isTeamManager" -> isTeamManager
      )
    }
  }
}

object TeamMembershipSQL {
  def publicReads(): Reads[TeamMembershipSQL] =
    ((__ \ "id").read[String](ObjectId.stringObjectIdReads("id")) and
      (__ \ "isTeamManager").read[Boolean]
      ) ((id, isTeamManager) => TeamMembershipSQL(ObjectId(id), isTeamManager))

}
