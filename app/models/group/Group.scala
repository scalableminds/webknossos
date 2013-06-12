package models.group

import models.basics.{SecuredMongoDAO, DBAccessContext, SecuredDAO, BasicDAO}
import reactivemongo.bson.BSONObjectID
import play.api.libs.json.Json
import scala.concurrent.Future
import play.modules.reactivemongo.json.BSONFormats.BSONObjectIDFormat
import play.api.libs.concurrent.Execution.Implicits._

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 12.06.13
 * Time: 01:42
 */
case class Group(name: String, teams: List[Team] = List(Team.everyone), owner: Option[BSONObjectID] = None, _id: BSONObjectID = BSONObjectID.generate) {
  val teamPaths = teams.map(t => name + GroupHelpers.teamSepperator + t.name)
}

trait GroupHelpers {

  val teamSepperator = "\\\\"

  def default = Group("Structure of Neocortical Circuits Group")

  def splitIntoTeamAndGroup(teamPath: String): Option[(String, Option[String])] = {
    teamPath.split(teamSepperator) match {
      case Array(group, team) => Some(group -> Some(team))
      case Array(group) => Some(group -> None)
      case _ => None
    }
  }
}

object GroupHelpers extends GroupHelpers

object GroupDAO extends SecuredMongoDAO[Group] with GroupHelpers {
  val collectionName = "groups"
  val formatter = Json.format[Group]

  def findAllGroups(groups: List[String])(implicit ctx: DBAccessContext) = {
    find(Json.obj("name" -> Json.obj("$in" -> groups))).toList
  }

  def findByGroupName(name: String)(implicit ctx: DBAccessContext) =
    findOne("name", name)

  def findByTeamPath(teamPath: String)(implicit ctx: DBAccessContext) = {
    splitIntoTeamAndGroup(teamPath).map {
      case (group, _) =>
        findByGroupName(group)
      case _ =>
        Future.successful(None)
    }
  }
}