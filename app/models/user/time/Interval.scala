package models.user.time

import org.joda.time.{DateTime, DateTimeConstants}
import play.api.libs.json.{Json, OFormat}

trait Interval {
  def start: DateTime

  def end: DateTime
}

case class Month(month: Int, year: Int) extends Interval with Ordered[Month] {

  def compare(p: Month): Int = 12 * (year - p.year) + (month - p.month)

  override def <(that: Month): Boolean = (this compare that) < 0

  override def >(that: Month): Boolean = (this compare that) > 0

  override def <=(that: Month): Boolean = (this compare that) <= 0

  override def >=(that: Month): Boolean = (this compare that) >= 0

  override def toString = f"$year%d-$month%02d"

  def start: DateTime =
    jodaMonth.dayOfMonth().withMinimumValue().millisOfDay().withMinimumValue()

  private def jodaMonth: DateTime = new DateTime().withYear(year).withMonthOfYear(month)

  def end: DateTime =
    jodaMonth.dayOfMonth().withMaximumValue().millisOfDay().withMaximumValue()
}

object Month {
  implicit val monthFormat: OFormat[Month] = Json.format[Month]
}

case class Week(week: Int, year: Int) extends Interval with Ordered[Week] {

  def compare(p: Week): Int = 53 * (year - p.year) + (week - p.week)

  override def <(that: Week): Boolean = (this compare that) < 0

  override def >(that: Week): Boolean = (this compare that) > 0

  override def <=(that: Week): Boolean = (this compare that) <= 0

  override def >=(that: Week): Boolean = (this compare that) >= 0

  override def toString = f"$year%d-W$week%02d"

  def start: DateTime =
    jodaWeek.withDayOfWeek(DateTimeConstants.MONDAY).millisOfDay().withMinimumValue()

  private def jodaWeek: DateTime = new DateTime().withYear(year).withWeekOfWeekyear(week)

  def end: DateTime =
    jodaWeek.dayOfWeek().withMaximumValue().millisOfDay().withMaximumValue()
}

object Week {
  implicit val weekFormat: OFormat[Week] = Json.format[Week]
}

case class Day(day: Int, month: Int, year: Int) extends Interval with Ordered[Day] {

  def compare(p: Day): Int = 500 * (year - p.year) + 40 * (month - p.month) + (day - p.day)

  override def <(that: Day): Boolean = (this compare that) < 0

  override def >(that: Day): Boolean = (this compare that) > 0

  override def <=(that: Day): Boolean = (this compare that) <= 0

  override def >=(that: Day): Boolean = (this compare that) >= 0

  override def toString = f"$year%d-$month%02d-$day%02d"

  def start: DateTime =
    jodaDay.millisOfDay().withMinimumValue()

  private def jodaDay = new DateTime().withDate(year, month, day)

  def end: DateTime =
    jodaDay.millisOfDay().withMaximumValue()
}

object Day {
  implicit val dayFormat: OFormat[Day] = Json.format[Day]
}
