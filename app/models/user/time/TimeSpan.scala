package models.user.time

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.schema.Tables._
import models.annotation.AnnotationSQL
import org.joda.time.DateTime
import play.api.Play.current
import play.api.i18n.Messages
import play.api.i18n.Messages.Implicits._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsValue, Json}
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._
import slick.jdbc.PostgresProfile.api._
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
  val MAX_TIMESTAMP = 253370761200000L

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
      r <- run(Timespans.filter(r => notdel(r) && r._User === userId.id && (r.created >= new java.sql.Timestamp(start.getOrElse(0))) && r.created <= new java.sql.Timestamp(end.getOrElse(MAX_TIMESTAMP))).result)
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def findAllByUserWithTask(userId: ObjectId, start: Option[Long], end: Option[Long]): Fox[JsValue] =
    for {
      tuples <- run(sql"""select ts.time, ts.created, a._id, ts._id, t._id, p.name, tt._id, tt.summary
                        from webknossos.timespans_ ts
                        join webknossos.annotations_ a on ts._annotation = a._id
                        join webknossos.tasks_ t on a._task = t._id
                        join webknossos.projects_ p on t._project = p._id
                        join webknossos.taskTypes_ tt on t._taskType = tt._id
                        where ts._user = ${userId.id}
                        and ts.time > 0
                        and ts.created >= ${new java.sql.Timestamp(start.getOrElse(0))}
                        and ts.created < ${new java.sql.Timestamp(end.getOrElse(MAX_TIMESTAMP))}"""
        .as[(Long, java.sql.Timestamp, String, String, String, String, String, String)])
    } yield formatTimespanTuples(tuples)



  def formatTimespanTuples(tuples: Vector[(Long, java.sql.Timestamp, String, String, String, String, String, String)]) = {

    def formatTimespanTuple(tuple: (Long, java.sql.Timestamp, String, String, String, String, String, String)) = {
      def formatDuration(millis: Long): String = {
        // example: P3Y6M4DT12H30M5S = 3 years + 9 month + 4 days + 12 hours + 30 min + 5 sec
        // only hours, min and sec are important in this scenario
        val h = millis / 3600000
        val m = (millis / 60000) % 60
        val s = (millis.toDouble / 1000) % 60

        s"PT${h}H${m}M${s}S"
      }

      Json.obj(
        "time" -> formatDuration(tuple._1),
        "timestamp" -> tuple._2.getTime,
        "annotation" -> tuple._3,
        "_id" -> tuple._4,
        "task_id" -> tuple._5,
        "project_name" -> tuple._6,
        "tasktype_id" -> tuple._7,
        "tasktype_summary" -> tuple._8
      )
    }
    Json.toJson(tuples.map(formatTimespanTuple))
  }

  def findAllByAnnotation(annotationId: ObjectId, start: Option[Long], end: Option[Long]): Fox[List[TimeSpanSQL]] =
    for {
      r <- run(Timespans.filter(r => notdel(r) && r._Annotation === annotationId.id && (r.created >= new java.sql.Timestamp(start.getOrElse(0))) && r.created <= new java.sql.Timestamp(end.getOrElse(MAX_TIMESTAMP))).result)
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def findAll(start: Option[Long], end: Option[Long]): Fox[List[TimeSpanSQL]] =
    for {
      r <- run(Timespans.filter(r => notdel(r) && (r.created >= new java.sql.Timestamp(start.getOrElse(0))) && r.created <= new java.sql.Timestamp(end.getOrElse(MAX_TIMESTAMP))).result)
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
      _ <- assertUpdateAccess(t._id) ?~> "FAILED: TimeSpanSQLDAO.assertUpdateAccess"
      r <- run(sqlu"""update webknossos.timespans
                set
                  _user = ${t._user.id},
                  _annotation = ${t._annotation.map(_.id)},
                  time = ${t.time},
                  lastUpdate = ${new java.sql.Timestamp(t.lastUpdate)},
                  numberOfUpdates = ${t.numberOfUpdates},
                  isDeleted = ${t.isDeleted}
                where _id = ${t._id.id}
        """) ?~> "FAILED: run() in TimeSpanSQLDAO.updateOne"
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

  def create(start: Long, end: Long, _user: BSONObjectID, annotation: Option[AnnotationSQL]) =
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
