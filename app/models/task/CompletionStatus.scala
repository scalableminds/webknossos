/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.task

import play.api.libs.json.Json

case class CompletionStatus(open: Int, active: Int, finished: Int){
  def total = open + active + finished
}

object CompletionStatus {
  implicit val completionStatusFormat = Json.format[CompletionStatus]

  def combine(a: CompletionStatus, b: CompletionStatus) =
    CompletionStatus(a.open + b.open, a.active + b.active, a.finished + b.finished)

}
