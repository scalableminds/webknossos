package models.task

import play.api.libs.json.{Json, OFormat}

case class CompletionStatus(open: Long, active: Long, finished: Long) {
  def total: Long = open + active + finished
}

object CompletionStatus {
  implicit val jsonFormat: OFormat[CompletionStatus] = Json.format[CompletionStatus]
}
