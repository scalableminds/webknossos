package models.task

import play.api.libs.json.Json

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 19.11.13
 * Time: 14:58
 */
case class CompletionStatus(open: Int, inProgress: Int, completed: Int)

object CompletionStatus {
  implicit val completionStatusFormat = Json.format[CompletionStatus]
}