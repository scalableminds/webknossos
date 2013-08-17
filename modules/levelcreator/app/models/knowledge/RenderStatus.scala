package models.knowledge

import play.api.libs.json.Json

case class AbortedRendering(levelId: String, reason: String)

object AbortedRendering{
  implicit val abortedRenderingFormat = Json.format[AbortedRendering]
}

case class RenderStatus( numberOfRenderedStacks: Int, renderedFor: List[String], abortedFor: List[AbortedRendering])

object RenderStatus{
  implicit val renderStatusFormat = Json.format[RenderStatus]

  def initial = {
    RenderStatus(0, Nil, Nil)
  }
}