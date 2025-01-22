package com.scalableminds.util.time

import org.checkerframework.checker.units.qual.s

import scala.collection.mutable.ListBuffer
import scala.concurrent.duration.FiniteDuration

trait DurationFormatting {

  def formatDuration(duration: FiniteDuration): String = {
    def pluralize(string: String, amount: Int): String =
      if (amount == 1) string else s"$string$s"

    val maxElements = 3
    val labelElements: ListBuffer[String] = new ListBuffer[String]

    var seconds: Float = duration.toMillis.toFloat / 1000

    def addLabel(label: String): Unit =
      if (labelElements.nonEmpty && labelElements.length < maxElements) {
        labelElements += label
      }

    val days = Math.floor(seconds / 86400).toInt
    if (days > 0) addLabel(s"${pluralize(days.toString, days)} day")
    seconds -= days * 24 * 3600

    val hours = Math.floor(seconds / 3600).toInt
    if (hours > 0) addLabel(s"${hours}h")
    seconds -= hours * 3600

    val minutes = Math.floor(seconds / 60).toInt
    if (minutes > 0) addLabel(s"${minutes}m")
    seconds -= minutes * 60

    val wholeSeconds = Math.ceil(seconds).toInt
    if (seconds >= 0 && wholeSeconds > 0) {
      if (labelElements.isEmpty) labelElements += s"$wholeSeconds$s"
      else labelElements += s"$wholeSeconds$s"
    }

    labelElements.mkString(" ")
  }
}
