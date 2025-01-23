package com.scalableminds.util.mvc

import com.scalableminds.util.tools.TextUtils

import java.text.SimpleDateFormat
import java.util.Date
import scala.collection.mutable.ListBuffer
import scala.concurrent.duration.FiniteDuration

trait Formatter {
  protected def formatDate(timestamp: Long): String =
    formatDate(new Date(timestamp))

  protected def formatDate(date: Date): String = {
    val sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm")
    sdf.format(date)
  }

  protected def formatDateForFilename(date: Date): String = {
    val sdf = new SimpleDateFormat("YYYY-MM-dd_HH-mm")
    sdf.format(date)
  }

  protected def formatHash(id: String): String =
    id.takeRight(6)

  protected def formatDuration(duration: FiniteDuration): String = {
    val sign = if (duration.toMillis < 0) "-" else ""
    var millisAbs = Math.abs(duration.toMillis).toInt

    if (millisAbs < 1000) {
      s"$sign${millisAbs}ms"
    } else if (millisAbs < 59995) { // up to 2 decimals for < 60s
      val wholeSeconds = Math.floor(millisAbs.toFloat / 1000).toInt
      val centis = Math.round(millisAbs.toFloat / 10) % 100
      val withTwoDecimals = f"$wholeSeconds.$centis%02d"
      // now drop the decimals from the right if they are zeroes.
      f"$sign${withTwoDecimals.reverse.dropWhile(_ == '0').dropWhile(_ == '.').reverse}s"
    } else {
      val labelElements: ListBuffer[String] = new ListBuffer[String]

      var days = Math.floor(millisAbs.toFloat / 1000 / 3600 / 24).toInt
      if (millisAbs - days * 24 * 3600 * 1000 > 23 * 3600 * 1000 + 59 * 60 * 1000 + 59499) { // extra day to avoid 24h/60m/60s
        days += 1
      }
      val includeSeconds = days == 0
      if (days > 0) {
        labelElements.addOne(TextUtils.pluralize(s"$days day", days))
        millisAbs -= days * 24 * 3600 * 1000
      }

      var hours = Math.floor(millisAbs.toFloat / 3600 / 1000).toInt
      if (millisAbs - hours * 3600 * 1000 > 59 * 60 * 1000 + 59499) { // extra hour to avoid 60m/60s
        hours += 1
      }
      if (hours > 0) {
        labelElements.addOne(s"${hours}h")
        millisAbs -= hours * 3600 * 1000
      }

      var minutes = Math.floor(millisAbs.toFloat / 60 / 1000).toInt
      if (millisAbs - minutes * 60 * 1000 > 59499) { // extra minute to avoid 60s
        minutes += 1
      }
      if (minutes > 0) {
        millisAbs -= minutes * 60 * 1000
        labelElements.addOne(s"${minutes}m")
      }

      val seconds = Math.round(millisAbs.toFloat / 1000)
      if (includeSeconds && seconds > 0) {
        labelElements += s"${seconds}s"
      }

      sign + labelElements.mkString(" ")
    }
  }

}
