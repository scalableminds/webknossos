package models.user.time

import org.joda.time.{DateTime, DateTimeConstants}
import play.api.libs.json.Json

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

  def start =
    jodaMonth.dayOfMonth().withMinimumValue().millisOfDay().withMinimumValue()

  def jodaMonth = new DateTime().withYear(year).withMonthOfYear(month)

  def end =
    jodaMonth.dayOfMonth().withMaximumValue().millisOfDay().withMaximumValue()
}

object Month {
  implicit val monthFormat = Json.format[Month]
}

case class Week(week: Int, year: Int) extends Interval with Ordered[Week] {

  def compare(p: Week): Int = 53 * (year - p.year) + (week - p.week)

  override def <(that: Week): Boolean = (this compare that) < 0

  override def >(that: Week): Boolean = (this compare that) > 0

  override def <=(that: Week): Boolean = (this compare that) <= 0

  override def >=(that: Week): Boolean = (this compare that) >= 0

  override def toString = f"$year%d-W$week%02d"

  def start =
    jodaWeek.withDayOfWeek(DateTimeConstants.MONDAY).millisOfDay().withMinimumValue()

  def jodaWeek = new DateTime().withYear(year).withWeekOfWeekyear(week)

  def end =
    jodaWeek.dayOfWeek().withMaximumValue().millisOfDay().withMaximumValue()
}

object Week {
  implicit val weekFormat = Json.format[Week]
}

case class Day(day: Int, month: Int, year: Int) extends Interval with Ordered[Day] {

  def compare(p: Day): Int = 500 * (year - p.year) + 40 * (month - p.month) + (day - p.day)

  override def <(that: Day): Boolean = (this compare that) < 0

  override def >(that: Day): Boolean = (this compare that) > 0

  override def <=(that: Day): Boolean = (this compare that) <= 0

  override def >=(that: Day): Boolean = (this compare that) >= 0

  override def toString = f"$year%d-$month%02d-$day%02d"

  def start =
    jodaDay.millisOfDay().withMinimumValue()

  def jodaDay = new DateTime().withDate(year, month, day)

  def end =
    jodaDay.millisOfDay().withMaximumValue()
}

object Day {
  implicit val dayFormat = Json.format[Day]
}
