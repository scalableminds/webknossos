package models.team

import play.api.libs.json.Json
import reactivemongo.bson.BSONObjectID
import play.modules.reactivemongo.json.BSONFormats._

case class Team(name: String, subTeams: List[Team], owner: Option[BSONObjectID] = None){
  def allTeamPaths: List[TeamPath] = {
    val subs = subTeams.flatMap(_.allTeamPaths)
    subs.map(path => name +: path)
  }

  def contains(teamPath: TeamPath): Boolean = teamPath match {
    case TeamPath(head :: Nil) if head == name =>
      true
    case TeamPath(head :: tail) if head == name =>
      subTeams.find(_.contains(TeamPath(tail))).isDefined
    case _ =>
      false
  }
}

object Team extends Function3[String, List[Team], Option[BSONObjectID], Team]{
  implicit val teamFormat = Json.format[Team]
}