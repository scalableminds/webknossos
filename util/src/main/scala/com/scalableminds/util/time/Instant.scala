package com.scalableminds.util.time
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import net.liftweb.common.Box.tryo
import play.api.libs.json._

import java.time.format.DateTimeFormatter
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.{DurationLong, FiniteDuration}

case class Instant(epochMillis: Long) extends Ordered[Instant] {
  override def toString: String = DateTimeFormatter.ISO_INSTANT.format(toJavaInstant)

  def toJavaInstant: java.time.Instant = java.time.Instant.ofEpochMilli(epochMillis)
  def toJodaDateTime: org.joda.time.DateTime = new org.joda.time.DateTime(epochMillis)
  def toSql: java.sql.Timestamp = new java.sql.Timestamp(epochMillis)

  def +(duration: FiniteDuration): Instant = Instant(epochMillis + duration.toMillis)
  def -(duration: FiniteDuration): Instant = Instant(epochMillis - duration.toMillis)

  def -(other: Instant): FiniteDuration = (epochMillis - other.epochMillis) milliseconds

  def isPast: Boolean = this < Instant.now

  override def compare(that: Instant): Int =
    if (this.epochMillis < that.epochMillis) -1
    else if (this.epochMillis > that.epochMillis) 1
    else 0

  def dayOfMonth: Int = toJodaDateTime.getDayOfMonth
  def monthOfYear: Int = toJodaDateTime.getMonthOfYear
  def year: Int = toJodaDateTime.getYear
  def weekOfWeekyear: Int = toJodaDateTime.getWeekOfWeekyear
  def weekyear: Int = toJodaDateTime.getWeekyear
}

object Instant extends FoxImplicits {
  def now: Instant = Instant(System.currentTimeMillis())
  def max: Instant = Instant(253370761200000L)
  def in(duration: FiniteDuration): Instant = now + duration
  def fromString(instantLiteral: String)(implicit ec: ExecutionContext): Fox[Instant] =
    fromStringSync(instantLiteral).toFox
  def fromJoda(jodaDateTime: org.joda.time.DateTime): Instant = Instant(jodaDateTime.getMillis)
  def fromSql(sqlTime: java.sql.Timestamp): Instant = Instant(sqlTime.getTime)
  private def fromStringSync(instantLiteral: String): Option[Instant] =
    tryo(java.time.Instant.parse(instantLiteral).toEpochMilli).toOption.map(timestamp => Instant(timestamp))

  implicit object InstantFormat extends Format[Instant] {
    override def reads(json: JsValue): JsResult[Instant] =
      json
        .validate[String]
        .flatMap { instantString =>
          val parsedOpt = fromStringSync(instantString)
          parsedOpt match {
            case Some(parsed) => JsSuccess(parsed)
            case None         => JsError(f"instant.invalid: $instantString")
          }
        }
        .orElse {
          json.validate[Long].flatMap { instantLong =>
            JsSuccess(Instant(instantLong))
          }
        }

    override def writes(i: Instant): JsValue = JsNumber(i.epochMillis)
  }
}
