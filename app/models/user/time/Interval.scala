package models.user.time

import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.AutoFormat

import java.time.temporal.TemporalAdjusters
import java.time.temporal.TemporalAdjusters.firstInMonth
import java.time.{DayOfWeek, LocalTime, ZoneId, ZonedDateTime}

trait Interval {
  def start: Instant

  def end: Instant
}

case class Month(month: Int, year: Int) extends Interval with Ordered[Month] derives AutoFormat {

  def compare(p: Month): Int = 12 * (year - p.year) + (month - p.month)

  override def toString: String = f"$year%d-$month%02d"

  def start: Instant =
    Instant.fromZonedDateTime(asZonedDateTime.`with`(TemporalAdjusters.firstDayOfMonth()).`with`(LocalTime.MIN))

  def end: Instant =
    Instant.fromZonedDateTime(asZonedDateTime.`with`(TemporalAdjusters.lastDayOfMonth()).`with`(LocalTime.MAX))

  private def asZonedDateTime: ZonedDateTime = ZonedDateTime.of(year, month, 1, 0, 0, 0, 0, ZoneId.of("UTC"))
}

case class Week(week: Int, year: Int) extends Interval with Ordered[Week] derives AutoFormat {

  def compare(p: Week): Int = 53 * (year - p.year) + (week - p.week)
  override def toString: String = f"$year%d-W$week%02d"

  def start: Instant =
    Instant.fromZonedDateTime(
      asZonedDateTime.`with`(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)).`with`(LocalTime.MIN)
    )

  def end: Instant =
    Instant.fromZonedDateTime(
      asZonedDateTime.`with`(TemporalAdjusters.nextOrSame(DayOfWeek.SUNDAY)).`with`(LocalTime.MAX)
    )

  private def asZonedDateTime: ZonedDateTime =
    ZonedDateTime
      .of(year, 1, 1, 0, 0, 0, 0, ZoneId.of("UTC"))
      .`with`(firstInMonth(DayOfWeek.MONDAY))
      .plusWeeks(week - 1)
}

case class Day(day: Int, month: Int, year: Int) extends Interval with Ordered[Day] derives AutoFormat {

  def compare(p: Day): Int = 500 * (year - p.year) + 40 * (month - p.month) + (day - p.day)

  override def toString: String = f"$year%d-$month%02d-$day%02d"

  def start: Instant =
    Instant.fromZonedDateTime(asZonedDateTime.`with`(LocalTime.MIN))

  def end: Instant =
    Instant.fromZonedDateTime(asZonedDateTime.`with`(LocalTime.MAX))

  private def asZonedDateTime: ZonedDateTime =
    ZonedDateTime.of(year, month, day, 0, 0, 0, 0, ZoneId.of("UTC"))
}
