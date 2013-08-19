package models.knowledge

import models.knowledge.basics.BasicReactiveDAO
import play.api.libs.json.Json
import braingames.reactivemongo.DBAccessContext

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 19.08.13
 * Time: 03:20
 */
case class ActiveLevel(gameName: String, levels: Map[String, Int]) {

}

object ActiveLevelDAO extends BasicReactiveDAO[ActiveLevel] {
  val collectionName = "activeLevels"

  implicit val formatter = Json.format[ActiveLevel]

  def addActiveLevel(gameName: String, levelId: LevelId)(implicit ctx: DBAccessContext) = {
    collectionUpdate(
      Json.obj("gameName" -> gameName),
      Json.obj("$set" -> Json.obj(
        "gameName" -> gameName,
        s"levels.${levelId.name}" -> levelId.version)))
  }

  def removeActiveLevel(gameName: String, levelId: LevelId)(implicit ctx: DBAccessContext) = {
    collectionUpdate(
      Json.obj("gameName" -> gameName, s"levels.${levelId.name}" -> levelId.version),
      Json.obj("$unset" -> Json.obj(
        s"levels.${levelId.name}" -> "")))
  }
}
