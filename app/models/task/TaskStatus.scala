package models.task

import com.scalableminds.util.tools.JsonAutoFormat

case class TaskStatus(pending: Long, active: Long, finished: Long) derives JsonAutoFormat {
  def total: Long = pending + active + finished
}
