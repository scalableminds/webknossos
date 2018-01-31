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
import slick.jdbc.PostgresProfile.api._
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

object TimeSpanSQL {
  def fromTimeSpan(t: TimeSpan)(implicit ctx: DBAccessContext): Fox[TimeSpanSQL] = {
    Fox.successful(TimeSpanSQL(
        ObjectId.fromBsonId(t._id),
        ObjectId.fromBsonId(t._user),
        t.annotation.map(ObjectId(_)),
        t.time,
        t.lastUpdate,
        t.numberOfUpdates.getOrElse(1),
        t.timestamp,
        false
    ))
  }
}

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

  def findAllByUser(userId: ObjectId, start: Option[Long], end: Option[Long]): Fox[List[TimeSpanSQL]] =
    for {
      r <- run(Timespans.filter(r => notdel(r) && r._User === userId.id && (r.created >= new java.sql.Timestamp(start.getOrElse(0))) && r.created <= new java.sql.Timestamp(end.getOrElse(Long.MaxValue))).result)
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def findAllByAnnotation(annotationId: ObjectId, start: Option[Long], end: Option[Long]): Fox[List[TimeSpanSQL]] =
    for {
      r <- run(Timespans.filter(r => notdel(r) && r._Annotation === annotationId.id && (r.created >= new java.sql.Timestamp(start.getOrElse(0))) && r.created <= new java.sql.Timestamp(end.getOrElse(Long.MaxValue))).result)
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def findAll(start: Option[Long], end: Option[Long]): Fox[List[TimeSpanSQL]] =
    for {
      r <- run(Timespans.filter(r => notdel(r) && (r.created >= new java.sql.Timestamp(start.getOrElse(0))) && r.created <= new java.sql.Timestamp(end.getOrElse(Long.MaxValue))).result)
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def insertOne(t: TimeSpanSQL)(implicit ctx: DBAccessContext): Fox[Unit] = {
    for {
      r <- run(sqlu"""insert into webknossos.timespans(_id, _user, _annotation, time, lastUpdate, numberOfUpdates, created, isDeleted)
                values(${t._id.id}, ${t._user.id}, ${t._annotation.map(_.id)}, ${t.time}, ${new java.sql.Timestamp(t.lastUpdate)}, ${t.numberOfUpdates}, ${new java.sql.Timestamp(t.created)}, ${t.isDeleted})""")
    } yield ()
  }

  def updateOne(t: TimeSpanSQL)(implicit ctx: DBAccessContext): Fox[Unit] = {
    for { //note that t.created is skipped
      r <- run(sqlu"""update webknossos.timespans
                set
                  _user = ${t._user.id},
                  _annotation = ${t._annotation.map(_.id)},
                  time = ${t.time},
                  lastUpdate = ${new java.sql.Timestamp(t.lastUpdate)},
                  numberOfUpdates = ${t.numberOfUpdates},
                  isDeleted = ${t.isDeleted}""")
    } yield ()
  }
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
