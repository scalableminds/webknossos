package models.task

import play.api.libs.json.Json

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 19.11.13
 * Time: 14:58
 */
case class CompletionStatus(open: Int, inProgress: Int, completed: Int){
  def total = open + inProgress + completed
}

object CompletionStatus {
  implicit val completionStatusFormat = Json.format[CompletionStatus]

  def combine(a: CompletionStatus, b: CompletionStatus) =
    CompletionStatus(a.open + b.open, a.inProgress + b.inProgress, a.completed + b.completed)

}
