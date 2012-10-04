package brainflight.format

import java.util.Date
import java.util.GregorianCalendar
import java.text.SimpleDateFormat
import java.util.TimeZone

object DateFormatter {
  def format(date: Date) = {
    val cal = new GregorianCalendar(TimeZone.getTimeZone("GMT+2"))
    val sdf = new SimpleDateFormat("HH:mm:ss dd-MMM-yyyy")
    sdf.setCalendar(cal)
    cal.setTime(date)
    sdf.format(date)
  }
}