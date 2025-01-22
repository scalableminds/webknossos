package com.scalableminds.util.time

import scala.collection.mutable.ListBuffer
import scala.concurrent.duration.FiniteDuration

trait DurationFormatting {

  protected def formatDuration(duration: FiniteDuration): String = {
    def pluralize(string: String, amount: Int): String =
      if (amount == 1) string else s"${string}s"

    if (duration.toMillis < 1000) {
      s"${duration.toMillis} ms"
    } else if (duration.toMillis < 60 * 1000) {
      val secondsFloat = duration.toMillis.toFloat / 1000
      f"$secondsFloat%.2fs"
    } else {
      val maxElements = 3
      val labelElements: ListBuffer[String] = new ListBuffer[String]

      var seconds: Float = duration.toMillis.toFloat / 1000

      val days = Math.floor(seconds / 3600 / 24).toInt
      if (days > 0 && labelElements.length < maxElements) {
        labelElements.addOne(pluralize(s"$days day", days))
        seconds -= days * 24 * 3600
      }

      val hours = Math.floor(seconds / 3600).toInt
      if (hours > 0 && labelElements.length < maxElements) {
        labelElements.addOne(s"${hours}h")
        seconds -= hours * 3600
      }

      val minutes = Math.floor(seconds / 60).toInt
      if (minutes > 0 && labelElements.length < maxElements) {
        labelElements.addOne(s"${minutes}m")
        seconds -= minutes * 60
      }

      val wholeSeconds = Math.ceil(seconds).toInt
      if (seconds >= 0 && labelElements.length < maxElements) {
        labelElements += s"${wholeSeconds}s"
      }

      labelElements.mkString(" ")
    }
  }

}
