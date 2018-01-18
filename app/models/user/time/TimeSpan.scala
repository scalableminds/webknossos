package models.user.time

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.schema.Tables._
import models.annotation.Annotation
import org.joda.time.DateTime
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.libs.concurrent.Execution.Implicits._
import play.api.Play.current
import play.api.i18n.Messages.Implicits._
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._
import slick.lifted.Rep
import utils.{ObjectId, SQLDAO}

import scala.concurrent.duration._

case class TimeSpanSQL(
                      _id: ObjectId,
                      _user: ObjectId,
                      _annotation: Option[ObjectId],
                      time: Long,
                      lastUpdate: Long,
                      numberOfUpdates: Long = 1,
                      created: Long = System.currentTimeMillis(),
                      isDeleted: Boolean = false
                      )


object TimeSpanSQLDAO extends SQLDAO[TimeSpanSQL, TimespansRow, Timespans] {
  val collection = Timespans

  def idColumn(x: Timespans): Rep[String] = x._Id
  def isDeletedColumn(x: Timespans): Rep[Boolean] = x.isdeleted

  def parse(r: TimespansRow): Fox[TimeSpanSQL] =
    Fox.successful(TimeSpanSQL(
      ObjectId(r._Id),
      ObjectId(r._User),
      r._Annotation.map(ObjectId(_)),
      r.time,
      r.lastupdate.getTime,
      r.numberofupdates,
      r.created.getTime,
      r.isdeleted
    ))
}



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

object TimeSpan extends FoxImplicits {
  implicit val timeSpanFormat = Json.format[TimeSpan]

  val timeRx = "(([0-9]+)d)?(\\s*([0-9]+)h)?(\\s*([0-9]+)m)?".r

  val hoursRx = "[0-9]+".r

  def create(start: Long, end: Long, _user: BSONObjectID, annotation: Option[Annotation]) =
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

  def fromTimeSpanSQL(s: TimeSpanSQL)(implicit ctx: DBAccessContext) = {
    for {
      userIdBson <- s._user.toBSONObjectId.toFox ?~> Messages("sql.invalidBSONObjectId", s._user.toString)
      idBson <- s._id.toBSONObjectId.toFox ?~> Messages("sql.invalidBSONObjectId", s._id.toString)
    } yield {
      TimeSpan(
        s.time,
        s.created,
        s.lastUpdate,
        userIdBson,
        None,
        s._annotation.map(_.toString),
        idBson,
        Some(s.numberOfUpdates)
      )
    }
  }
}

case class TimeSpanRequest(users: List[String], start: Long, end: Long)

object TimeSpanRequest {
  implicit val timeSpanRequest = Json.format[TimeSpanRequest]
}
