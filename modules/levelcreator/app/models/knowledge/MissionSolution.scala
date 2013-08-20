package models.knowledge

import models.knowledge.basics.BasicReactiveDAO
import play.api.libs.json.{JsObject, Json}
import java.util.Date

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
case class MissionSolution(mission: MissionInfo, token: String, game: String, userId: JsObject, solution: SegmentSolution, timestamp: Long = System.currentTimeMillis){
  def date = new Date(timestamp)
}


object MissionSolutionDAO extends BasicReactiveDAO[MissionSolution]{
  val collectionName = "solutions"


  implicit val formatter = Json.format[MissionSolution]
}
