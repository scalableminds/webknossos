package models.task

import play.api.libs.json.{Json, OFormat}

case class TaskStatus(pending: Long, active: Long, finished: Long) {
  def total: Long = pending + active + finished
}

object TaskStatus {
  implicit val jsonFormat: OFormat[TaskStatus] = Json.format[TaskStatus]
}
