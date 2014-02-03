package models.team

import play.api.libs.json.Json
import reactivemongo.bson.BSONObjectID
import play.modules.reactivemongo.json.BSONFormats._
import braingames.reactivemongo.{DBAccessContext, SecuredDAO}
import models.basics.SecuredBaseDAO
import braingames.util.FoxImplicits

case class Team(name: String, roles: List[Role], owner: Option[BSONObjectID] = None)

object Team extends {

  implicit val teamFormat = Json.format[Team]
}

object TeamDAO extends SecuredBaseDAO[Team] with FoxImplicits {
  val collectionName = "teams"

  implicit val formatter = Team.teamFormat

  def findOneByName(name: String)(implicit ctx: DBAccessContext) =
    findOne("name", name)

}