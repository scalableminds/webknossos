package com.scalableminds.util.mvc

import java.text.SimpleDateFormat
import java.util.Date

import scala.concurrent.duration.Duration

object Formatter extends Formatter

trait Formatter {
  def formatDate(timestamp: Long): String =
    formatDate(new Date(timestamp))

  def formatDate(date: Date): String = {
    val sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm")
    sdf.format(date)
  }

  def formatDateForFilename(date: Date): String = {
    val sdf = new SimpleDateFormat("YYYY-MM-dd_HH-mm")
    sdf.format(date)
  }

  def formatHash(id: String): String =
    id.takeRight(6)

  def formatDuration(time: Duration): String =
    if (time == Duration.Inf)
      "infinite"
    else {
      val days = time.toDays
      val hours = time.toHours % 24
      val minutes = time.toMinutes % 60
      val seconds = time.toSeconds % 60

      (days, hours, minutes) match {
        case (0, 0, 0) => s"${seconds}s"
        case (0, 0, _) => s"${minutes}m ${seconds}s"
        case (0, _, _) => s"${hours}h ${minutes}m ${seconds}s"
        case _         => s"${days}d ${hours}h ${minutes}m ${seconds}s"
      }
    }

  def formatShortText(text: String, maxLength: Int = 100): String =
    if (text.length() > maxLength && maxLength > 4) {
      text.substring(0, maxLength - 4) + " ..."
    } else {
      text
    }
}
