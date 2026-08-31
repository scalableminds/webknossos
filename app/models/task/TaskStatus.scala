package models.task

import com.scalableminds.util.tools.AutoJsonFormat

case class TaskStatus(pending: Long, active: Long, finished: Long) derives AutoJsonFormat {
  def total: Long = pending + active + finished
}
