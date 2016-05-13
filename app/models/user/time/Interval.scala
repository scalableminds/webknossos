package models.user.time

import play.api.libs.json.Json
import java.util.Calendar
import org.joda.time.{DateTimeConstants, DateTime}

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 28.10.13
 * Time: 00:58
 */
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

  def start = {
    jodaMonth.dayOfMonth().withMinimumValue().millisOfDay().withMinimumValue()
  }

  def jodaMonth = new DateTime().withYear(year).withMonthOfYear(month)

  def end = {
    jodaMonth.dayOfMonth().withMaximumValue().millisOfDay().withMaximumValue()
  }
}

object Month {
  implicit val monthFormat = Json.format[Month]
}

case class Week(week: Int, year: Int) extends Interval with Ordered[Week] {

  def compare(p: Week): Int = 12 * (year - p.year) + (week - p.week)

  override def <(that: Week): Boolean = (this compare that) < 0

  override def >(that: Week): Boolean = (this compare that) > 0

  override def <=(that: Week): Boolean = (this compare that) <= 0

  override def >=(that: Week): Boolean = (this compare that) >= 0

  override def toString = f"$year%d-W$week%02d"

  def start = {
    jodaWeek.withDayOfWeek(DateTimeConstants.MONDAY).millisOfDay().withMinimumValue()
  }

  def jodaWeek = new DateTime().withYear(year).withWeekOfWeekyear(week)

  def end = {
    jodaWeek.dayOfWeek().withMaximumValue().millisOfDay().withMaximumValue()
  }
}

object Week {
  implicit val weekFormat = Json.format[Week]
}
