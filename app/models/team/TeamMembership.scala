package models.team

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import play.api.libs.functional.syntax._
import play.api.libs.json.{Json, _}
import scala.concurrent.ExecutionContext.Implicits._
import reactivemongo.play.json.BSONFormats._
import reactivemongo.bson.BSONObjectID
import utils.ObjectId


case class TeamMembershipSQL(teamId: ObjectId, isTeamManager: Boolean)

object TeamMembershipSQL {
  def fromTeamMembership(t: TeamMembership)(implicit ctx: DBAccessContext): Fox[TeamMembershipSQL] = {
    for {
      team <- TeamSQLDAO.findOne(ObjectId.fromBsonId(t._id))
    } yield {
      TeamMembershipSQL(team._id, t.isTeamManager)
    }
  }
}

case class TeamMembership(_id: BSONObjectID, name: String, isTeamManager: Boolean) {
  override def toString =
    if (isTeamManager)
      s"teamManager - ${_id}"
    else
      s"user - ${_id}"
}

object TeamMembership extends FoxImplicits {
  implicit val teamMembershipFormat = Json.format[TeamMembership]

  def teamMembershipPublicWrites(teamMembership: TeamMembership): JsObject =
    Json.obj(
      "id" -> teamMembership._id.stringify,
      "isTeamManager" -> teamMembership.isTeamManager,
      "name" -> teamMembership.name
    )

  def teamMembershipPublicReads(): Reads[TeamMembership] =
    ((__ \ "id").read[String](ObjectId.stringBSONObjectIdReads("id")) and
      (__ \ "name").read[String] and
      (__ \ "isTeamManager").read[Boolean]
      ) ((id, name, isTeamManager) => TeamMembership(BSONObjectID(id), name, isTeamManager))

  def fromTeamMembershipSQL(t: TeamMembershipSQL)(implicit ctx: DBAccessContext): Fox[TeamMembership] =
    for {
      team <- TeamSQLDAO.findOne(t.teamId)
      bsonId <- t.teamId.toBSONObjectId.toFox
    } yield {
      TeamMembership(bsonId, team.name, t.isTeamManager)
    }
}
