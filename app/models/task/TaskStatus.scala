package models.task

import com.scalableminds.util.tools.AutoFormat

case class TaskStatus(pending: Long, active: Long, finished: Long) derives AutoFormat {
  def total: Long = pending + active + finished
}
