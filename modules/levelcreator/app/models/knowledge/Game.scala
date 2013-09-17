package models.knowledge

import models.knowledge.basics.BasicReactiveDAO
import play.api.libs.json.Json
import braingames.reactivemongo.DBAccessContext
import play.api.libs.concurrent.Execution.Implicits._

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 18.08.13
 * Time: 14:53
 */
case class Game(name: String)

object GameDAO extends BasicReactiveDAO[Game]{
  val collectionName = "games"
  implicit val formatter = Json.format[Game]


  def findOneByName(name: String)(implicit ctx: DBAccessContext) = {
    collectionFind(Json.obj("name" -> name)).one[Game]
  }
}
