package models.knowledge

import play.api.libs.json.Json
import reactivemongo.bson.BSONObjectID
import play.modules.reactivemongo.json.BSONFormats._

case class AbortedRendering(levelId: LevelId, reason: String)

object AbortedRendering{
  implicit val abortedRenderingFormat = Json.format[AbortedRendering]
}

case class RenderStatus( numberOfRenderedStacks: Int, renderedFor: List[LevelId], abortedFor: List[AbortedRendering])

case class MissionStatus(renderStatus: RenderStatus = RenderStatus.initial, numberOfSolutions: Int = 0)

object RenderStatus{
  implicit val renderStatusFormat = Json.format[RenderStatus]

  def initial = {
    RenderStatus(0, Nil, Nil)
  }
}

object MissionStatus{
  implicit val missionStatusFormat = Json.format[MissionStatus]

  def initial = {
    MissionStatus()
  }
}