package com.scalableminds.util.mvc

import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.TextUtils
import com.scalableminds.util.tools.{Box, Failure, Full, ParamFailure}
import play.api.i18n.{Messages, MessagesProvider}

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
    val minuteRoundingThresholdMillisForRenderingMillis = 59995
    val minuteRoundingThresholdMillisForRenderingSeconds = 59499
    val sign = if (duration.toMillis < 0) "-" else ""
    var millisAbs = Math.abs(duration.toMillis)

    if (millisAbs < 1000) {
      s"$sign${millisAbs}ms"
    } else if (millisAbs < minuteRoundingThresholdMillisForRenderingMillis) { // up to 2 decimals for < 60s
      val wholeSeconds = Math.floor(millisAbs.toDouble / 1000).toLong
      val centis = Math.round(millisAbs.toDouble / 10) % 100
      if (centis == 0) f"$sign${wholeSeconds}s"
      else if (centis % 10 == 0) f"$sign$wholeSeconds.${centis / 10}s"
      else f"$sign$wholeSeconds.$centis%02ds"
    } else {
      val labelElements: ListBuffer[String] = new ListBuffer[String]

      var days = Math.floor(millisAbs.toDouble / 1000 / 3600 / 24).toLong
      if (millisAbs - days * 24 * 3600 * 1000 > 23 * 3600 * 1000 + 59 * 60 * 1000 + minuteRoundingThresholdMillisForRenderingSeconds) { // extra day to avoid 24h/60m/60s
        days += 1
      }
      val includeSeconds = days == 0
      if (days > 0) {
        labelElements.addOne(TextUtils.pluralize(s"$days day", days.toInt))
        millisAbs -= days * 24 * 3600 * 1000
      }

      var hours = Math.floor(millisAbs.toDouble / 3600 / 1000).toLong
      if (millisAbs - hours * 3600 * 1000 > 59 * 60 * 1000 + minuteRoundingThresholdMillisForRenderingSeconds) { // extra hour to avoid 60m/60s
        hours += 1
      }
      if (hours > 0) {
        labelElements.addOne(s"${hours}h")
        millisAbs -= hours * 3600 * 1000
      }

      var minutes = Math.floor(millisAbs.toDouble / 60 / 1000).toLong
      if (millisAbs - minutes * 60 * 1000 > minuteRoundingThresholdMillisForRenderingSeconds) { // extra minute to avoid 60s
        minutes += 1
      }
      if (minutes > 0) {
        millisAbs -= minutes * 60 * 1000
        labelElements.addOne(s"${minutes}m")
      }

      val seconds = Math.round(millisAbs.toDouble / 1000)
      if (includeSeconds && seconds > 0) {
        labelElements += s"${seconds}s"
      }

      sign + labelElements.mkString(" ")
    }
  }

  protected def formatFailureChain(failure: Failure,
                                   includeStackTraces: Boolean = false,
                                   includeTime: Boolean = false,
                                   messagesProviderOpt: Option[MessagesProvider] = None): String = {

    def formatStackTrace(failure: Failure) =
      failure.exception match {
        case Full(exception) =>
          if (includeStackTraces)
            s" Stack trace: ${TextUtils.stackTraceAsString(exception)} "
          else
            s" ${exception.toString}"
        case _ => ""
      }

    def formatNextChain(chainBox: Box[Failure]): String = chainBox match {
      case Full(chainFailure) =>
        " <~ " + formatFailureChain(chainFailure, includeStackTraces, includeTime = false, messagesProviderOpt)
      case _ => ""
    }

    def formatMsg(msg: String): String =
      messagesProviderOpt.map(mp => Messages(msg)(mp)).getOrElse(msg)

    def formatOneFailure(failure: Failure): String =
      failure match {
        case ParamFailure(msg, _, _, param) => formatMsg(msg) + " " + param.toString
        case Failure(msg, _, _)             => formatMsg(msg)
      }

    val serverTimeMsg = if (includeTime) s"[Server Time ${Instant.now}] " else ""
    serverTimeMsg + formatOneFailure(failure) + formatStackTrace(failure) + formatNextChain(failure.chain)
  }

}
