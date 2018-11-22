package models.task

import play.api.libs.json.Json

case class CompletionStatus(open: Long, active: Long, finished: Long) {
  def total = open + active + finished
}

object CompletionStatus {
  implicit val completionStatusFormat = Json.format[CompletionStatus]

  def combine(a: CompletionStatus, b: CompletionStatus) =
    CompletionStatus(a.open + b.open, a.active + b.active, a.finished + b.finished)

}
