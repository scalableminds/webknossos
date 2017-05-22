package models.user.time

import java.util.{Calendar, Date}
import models.annotation.AnnotationLike
import play.api.libs.json.Json
import reactivemongo.bson.BSONObjectID
import scala.concurrent.duration.Duration
import scala.concurrent.duration._
import reactivemongo.play.json.BSONFormats._
import org.joda.time.DateTime

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 28.10.13
 * Time: 00:58
 */
case class TimeSpan(
                     time: Long,
                     timestamp: Long,
                     lastUpdate: Long,
                     _user: BSONObjectID,
                     note: Option[String] = None,
                     annotation: Option[String] = None,
                     _id: BSONObjectID = BSONObjectID.generate,
                     numberOfUpdates: Option[Long] = Some(0)) {
  val created = new DateTime(timestamp)

  def annotationEquals(other: String): Boolean =
    annotationEquals(Some(other))

  def annotationEquals(other: Option[String]): Boolean =
    annotation == other

  def addTime(duration: Long, timestamp: Long) =
    this.copy(
      lastUpdate = timestamp,
      time = time + duration,
      numberOfUpdates = Some(this.numberOfUpdates.getOrElse(0L) + 1))
}

object TimeSpan {
  implicit val timeSpanFormat = Json.format[TimeSpan]

  val timeRx = "(([0-9]+)d)?(\\s*([0-9]+)h)?(\\s*([0-9]+)m)?".r

  val hoursRx = "[0-9]+".r

  def create(start: Long, end: Long, _user: BSONObjectID, annotation: Option[AnnotationLike]) =
    TimeSpan(end - start, start, end, _user = _user, annotation = annotation.map(_.id))

  def inMillis(days: Int, hours: Int, minutes: Int) =
    (days.days + hours.hours + minutes.minutes).toMillis

  def parseTime(s: String): Option[Long] = {
    s match {
      case timeRx(_, d, _, h, _, m) if d != null || h != null || m != null =>
        Some(inMillis(d.toInt, h.toInt, m.toInt))
      case hoursRx(h) if h != null =>
        Some(inMillis(0, h.toInt, 0))
      case _ =>
        None
    }
  }

  def groupByMonth(timeSpan: TimeSpan) = {
    Month(timeSpan.created.getMonthOfYear, timeSpan.created.getYear)
  }

  def groupByWeek(timeSpan: TimeSpan) = {
    Week(timeSpan.created.getWeekOfWeekyear, timeSpan.created.getWeekyear)
  }

  def groupByDay(timeSpan: TimeSpan) = {
    Day(timeSpan.created.getDayOfMonth, timeSpan.created.getMonthOfYear, timeSpan.created.getYear)
  }
}

case class TimeSpanRequest(users: List[String], start: Long, end: Long)

object TimeSpanRequest {
  implicit val timeSpanRequest = Json.format[TimeSpanRequest]
}
