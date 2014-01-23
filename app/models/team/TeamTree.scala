package models.team

import models.basics.SecuredBaseDAO
import reactivemongo.bson.BSONObjectID
import play.api.libs.json.Json
import scala.concurrent.Future
import play.modules.reactivemongo.json.BSONFormats.BSONObjectIDFormat
import play.api.libs.concurrent.Execution.Implicits._
import braingames.reactivemongo.{DBAccessContext, SecuredMongoDAO}

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 12.06.13
 * Time: 01:42
 */

case class TeamTree(root: Team, _id: BSONObjectID = BSONObjectID.generate) {

  val teamPaths = root.allTeamPaths

  def contains(teamPath: TeamPath) = {
    root.contains(teamPath)
  }
}

object TeamTreeDAO extends SecuredBaseDAO[TeamTree] {

  val collectionName = "teams"
  val formatter = Json.format[TeamTree]

  def isValidTeamName(name : String) =
    !name.contains(TeamPath.TeamSeparator) && !name.contains(TeamPath.All)

  def findAllTeams(teams: List[String])(implicit ctx: DBAccessContext) = {
    find(Json.obj("root.name" -> Json.obj("$in" -> teams))).collect[List]()
  }

  def findByTeamName(name: String)(implicit ctx: DBAccessContext) =
    findOne("root.name", name)

  /*def findByTeamPath(teamPath: String)(implicit ctx: DBAccessContext) = {
    TeamPath.fromString(teamPath) match {
      case TeamPath(head :: tail) =>
        findByTeamName(head).map(_.)
      case _ =>
        Future.successful(None)
  }*/
}