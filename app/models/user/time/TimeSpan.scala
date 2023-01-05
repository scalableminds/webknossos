package models.user.time

import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import play.api.libs.json.{JsValue, Json, OFormat}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.sql.{SqlClient, SQLDAO}
import utils.ObjectId

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

case class TimeSpanRequest(users: List[String], start: Instant, end: Instant)
object TimeSpanRequest { implicit val timeSpanRequest: OFormat[TimeSpanRequest] = Json.format[TimeSpanRequest] }

case class TimeSpan(
    _id: ObjectId,
    _user: ObjectId,
    _annotation: Option[ObjectId],
    time: Long,
    lastUpdate: Instant,
    numberOfUpdates: Long = 0,
    created: Instant = Instant.now,
    isDeleted: Boolean = false
) {
  def addTime(duration: FiniteDuration, timestamp: Instant): TimeSpan =
    this.copy(lastUpdate = timestamp, time = time + duration.toMillis, numberOfUpdates = this.numberOfUpdates + 1)
}

object TimeSpan {

  def groupByMonth(timeSpan: TimeSpan): Month =
    Month(timeSpan.created.monthOfYear, timeSpan.created.year)

  def groupByWeek(timeSpan: TimeSpan): Week =
    Week(timeSpan.created.weekOfWeekyear, timeSpan.created.weekyear)

  def groupByDay(timeSpan: TimeSpan): Day =
    Day(timeSpan.created.dayOfMonth, timeSpan.created.monthOfYear, timeSpan.created.year)

  def fromTimestamp(timestamp: Instant, _user: ObjectId, _annotation: Option[ObjectId]): TimeSpan =
    TimeSpan(ObjectId.generate, _user, _annotation, time = 0L, lastUpdate = timestamp, created = timestamp)

}

class TimeSpanDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[TimeSpan, TimespansRow, Timespans](sqlClient) {
  protected val collection = Timespans

  protected def idColumn(x: Timespans): Rep[String] = x._Id
  protected def isDeletedColumn(x: Timespans): Rep[Boolean] = x.isdeleted

  protected def parse(r: TimespansRow): Fox[TimeSpan] =
    Fox.successful(
      TimeSpan(
        ObjectId(r._Id),
        ObjectId(r._User),
        r._Annotation.map(ObjectId(_)),
        r.time,
        Instant.fromSql(r.lastupdate),
        r.numberofupdates,
        Instant.fromSql(r.created),
        r.isdeleted
      ))

  def findAllByUser(userId: ObjectId, start: Option[Instant], end: Option[Instant]): Fox[List[TimeSpan]] =
    for {
      r <- run(
        Timespans
          .filter(
            r =>
              notdel(r) && r._User === userId.id && (r.created >= start
                .getOrElse(Instant.zero)
                .toSql) && r.created <= end.getOrElse(Instant.max).toSql)
          .result)
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def findAllByUserWithTask(userId: ObjectId, start: Option[Instant], end: Option[Instant]): Fox[JsValue] =
    for {
      tuples <- run(sql"""select ts.time, ts.created, a._id, ts._id, t._id, p.name, tt._id, tt.summary
                        from webknossos.timespans_ ts
                        join webknossos.annotations_ a on ts._annotation = a._id
                        join webknossos.tasks_ t on a._task = t._id
                        join webknossos.projects_ p on t._project = p._id
                        join webknossos.taskTypes_ tt on t._taskType = tt._id
                        where ts._user = ${userId.id}
                        and ts.time > 0
                        and ts.created >= ${start.getOrElse(Instant.zero)}
                        and ts.created < ${end
        .getOrElse(Instant.max)}""".as[(Long, Instant, String, String, String, String, String, String)])
    } yield formatTimespanTuples(tuples)

  private def formatTimespanTuples(tuples: Vector[(Long, Instant, String, String, String, String, String, String)]) = {

    def formatTimespanTuple(tuple: (Long, Instant, String, String, String, String, String, String)) = {
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
        "timestamp" -> tuple._2,
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

  def findAllByAnnotation(annotationId: ObjectId, start: Option[Instant], end: Option[Instant]): Fox[List[TimeSpan]] =
    for {
      r <- run(
        Timespans
          .filter(
            r =>
              notdel(r) && r._Annotation === annotationId.id && (r.created >= start
                .getOrElse(Instant.zero)
                .toSql) && r.created <= end.getOrElse(Instant.max).toSql)
          .result)
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def findAll(start: Option[Instant], end: Option[Instant], organizationId: ObjectId): Fox[List[TimeSpan]] =
    for {
      r <- run(sql"""select #${columnsWithPrefix("t.")} from #$existingCollectionName t
              join webknossos.users u on t._user = u._id
              where t.created >= ${start.getOrElse(Instant.zero)} and t.created <= ${end.getOrElse(Instant.max)}
              and u._organization = $organizationId
          """.as[TimespansRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def insertOne(t: TimeSpan): Fox[Unit] =
    for {
      _ <- run(
        sqlu"""insert into webknossos.timespans(_id, _user, _annotation, time, lastUpdate, numberOfUpdates, created, isDeleted)
                values(${t._id.id}, ${t._user.id}, ${t._annotation.map(_.id)}, ${t.time}, ${t.lastUpdate},
                ${t.numberOfUpdates}, ${t.created}, ${t.isDeleted})""")
    } yield ()

  def updateOne(t: TimeSpan): Fox[Unit] =
    for { //note that t.created is skipped
      _ <- run(sqlu"""update webknossos.timespans
                set
                  _user = ${t._user.id},
                  _annotation = ${t._annotation.map(_.id)},
                  time = ${t.time},
                  lastUpdate = ${t.lastUpdate},
                  numberOfUpdates = ${t.numberOfUpdates},
                  isDeleted = ${t.isDeleted}
                where _id = ${t._id.id}
        """) ?~> "FAILED: run() in TimeSpanSQLDAO.updateOne"
    } yield ()
}
