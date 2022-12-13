package models.user.time

import com.scalableminds.util.time.Instant
import org.joda.time.{DateTime, DateTimeConstants}
import play.api.libs.json.{Json, OFormat}

trait Interval {
  def start: Instant

  def end: Instant
}

case class Month(month: Int, year: Int) extends Interval with Ordered[Month] {

  def compare(p: Month): Int = 12 * (year - p.year) + (month - p.month)

  override def toString = f"$year%d-$month%02d"

  def start: Instant =
    Instant.fromJoda(jodaMonth.dayOfMonth().withMinimumValue().millisOfDay().withMinimumValue())

  def end: Instant =
    Instant.fromJoda(jodaMonth.dayOfMonth().withMaximumValue().millisOfDay().withMaximumValue())

  private def jodaMonth: DateTime = new DateTime().withYear(year).withMonthOfYear(month)
}

object Month {
  implicit val monthFormat: OFormat[Month] = Json.format[Month]
}

case class Week(week: Int, year: Int) extends Interval with Ordered[Week] {

  def compare(p: Week): Int = 53 * (year - p.year) + (week - p.week)
  override def toString = f"$year%d-W$week%02d"

  def start: Instant =
    Instant.fromJoda(jodaWeek.withDayOfWeek(DateTimeConstants.MONDAY).millisOfDay().withMinimumValue())

  def end: Instant =
    Instant.fromJoda(jodaWeek.dayOfWeek().withMaximumValue().millisOfDay().withMaximumValue())

  private def jodaWeek: DateTime = new DateTime().withYear(year).withWeekOfWeekyear(week)
}

object Week {
  implicit val weekFormat: OFormat[Week] = Json.format[Week]
}

case class Day(day: Int, month: Int, year: Int) extends Interval with Ordered[Day] {

  def compare(p: Day): Int = 500 * (year - p.year) + 40 * (month - p.month) + (day - p.day)

  override def toString = f"$year%d-$month%02d-$day%02d"

  def start: Instant =
    Instant.fromJoda(jodaDay.millisOfDay().withMinimumValue())

  def end: Instant =
    Instant.fromJoda(jodaDay.millisOfDay().withMaximumValue())

  private def jodaDay = new DateTime().withDate(year, month, day)
}

object Day {
  implicit val dayFormat: OFormat[Day] = Json.format[Day]
}
