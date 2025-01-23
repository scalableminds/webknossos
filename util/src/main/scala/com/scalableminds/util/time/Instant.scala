package com.scalableminds.util.time

import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.{LazyLogging, Logger}
import net.liftweb.common.Box.tryo
import play.api.libs.json._

import java.time.{ZoneId, ZonedDateTime}
import java.time.format.DateTimeFormatter
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.{DurationLong, FiniteDuration}

case class Instant(epochMillis: Long) extends Ordered[Instant] {
  override def toString: String = DateTimeFormatter.ISO_INSTANT.format(toJavaInstant)

  private def toJavaInstant: java.time.Instant = java.time.Instant.ofEpochMilli(epochMillis)

  def toZonedDateTime: ZonedDateTime = ZonedDateTime.ofInstant(toJavaInstant, ZoneId.systemDefault())

  def toSql: java.sql.Timestamp = new java.sql.Timestamp(epochMillis)

  def toNanosecondsString: String = s"${epochMillis}000000"

  def +(duration: FiniteDuration): Instant = Instant(epochMillis + duration.toMillis)

  def -(duration: FiniteDuration): Instant = Instant(epochMillis - duration.toMillis)

  def -(other: Instant): FiniteDuration = (epochMillis - other.epochMillis) milliseconds

  def isPast: Boolean = this < Instant.now

  override def compare(that: Instant): Int =
    this.epochMillis.compare(that.epochMillis)

  def dayOfMonth: Int = toZonedDateTime.getDayOfMonth

  def monthOfYear: Int = toZonedDateTime.getMonthValue

  def year: Int = toZonedDateTime.getYear

  def weekOfWeekyear: Int = toZonedDateTime.get(java.time.temporal.IsoFields.WEEK_OF_WEEK_BASED_YEAR)

  def weekyear: Int = toZonedDateTime.get(java.time.temporal.IsoFields.WEEK_BASED_YEAR)
}

object Instant extends FoxImplicits with LazyLogging with Formatter {
  def now: Instant = Instant(System.currentTimeMillis())

  def max: Instant = Instant(253370761200000L)

  def zero: Instant = Instant(0L)

  def in(duration: FiniteDuration): Instant = now + duration

  def fromZonedDateTime(zonedDateTime: ZonedDateTime): Instant = Instant(zonedDateTime.toInstant.toEpochMilli)

  def fromSql(sqlTime: java.sql.Timestamp): Instant = Instant(sqlTime.getTime)

  def fromLocalTimeString(localTimeLiteral: String)(implicit ec: ExecutionContext): Fox[Instant] =
    tryo(new java.text.SimpleDateFormat("yyyy-MM-dd'T'hh:mm:ss.SSS").parse(localTimeLiteral))
      .map(date => Instant(date.getTime))
      .toFox

  def fromNanosecondsString(nanosecondsString: String): Instant =
    Instant(nanosecondsString.substring(0, nanosecondsString.length - 6).toLong)

  def since(before: Instant): FiniteDuration = now - before

  def nowFox(implicit ec: ExecutionContext): Fox[Instant] = Fox.successful(Instant.now)

  def logSince(before: Instant, label: String, l: Logger = logger): Unit =
    l.info(f"$label took ${formatDuration(Instant.since(before))}")

  def fromString(instantLiteral: String): Option[Instant] =
    fromIsoString(instantLiteral).orElse(fromEpochMillisString(instantLiteral))

  private def fromIsoString(instantLiteral: String): Option[Instant] =
    tryo(java.time.Instant.parse(instantLiteral).toEpochMilli).toOption.map(timestamp => Instant(timestamp))

  private def fromEpochMillisString(instantLiteral: String): Option[Instant] =
    tryo(instantLiteral.toLong).map(timestamp => Instant(timestamp))

  implicit object InstantFormat extends Format[Instant] {
    override def reads(json: JsValue): JsResult[Instant] =
      json
        .validate[Long]
        .flatMap { instantLong =>
          JsSuccess(Instant(instantLong))
        }
        .orElse {
          json.validate[String].flatMap { instantString =>
            val parsedOpt = fromString(instantString)
            parsedOpt match {
              case Some(parsed) => JsSuccess(parsed)
              case None         => JsError(f"instant.invalid: $instantString")
            }
          }
        }

    override def writes(i: Instant): JsValue = JsNumber(i.epochMillis)
  }
}
