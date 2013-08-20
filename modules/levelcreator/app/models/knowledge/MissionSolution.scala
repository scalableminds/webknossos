package models.knowledge

import models.knowledge.basics.BasicReactiveDAO
import play.api.libs.json.{JsObject, Json}
import java.util.Date
import braingames.reactivemongo.DBAccessContext
import reactivemongo.bson.BSONObjectID
import play.modules.reactivemongo.json.BSONFormats._
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.api.indexes.{IndexType, Index}

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 20.08.13
 * Time: 01:57
 */
case class SegmentSolution(segmentId: Int, solution: Int)

object SegmentSolution{
  implicit val segmentSolutionFormatter = Json.format[SegmentSolution]
}
case class MissionSolution(mission: MissionInfo, token: String, game: String, userId: JsObject, solution: List[SegmentSolution], _renderedStack: BSONObjectID, timestamp: Long = System.currentTimeMillis){
  def date = new Date(timestamp)
}

object MissionSolution{
  implicit val missionSolutionFormat = Json.format[MissionSolution]
}


object MissionSolutionDAO extends BasicReactiveDAO[MissionSolution]{

  val collectionName = "solutions"

  collection.indexesManager.ensure(Index(Seq("mission.key" -> IndexType.Ascending)))

  implicit val formatter = MissionSolution.missionSolutionFormat

  def findByMissionKeyRx(missionKeyRx: String)(implicit ctx: DBAccessContext) = {
    collectionFind(Json.obj("mission.key" -> Json.obj("$regex" -> missionKeyRx))).cursor[MissionSolution].toList
  }
}
