package models.user.time

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import javax.inject.Inject
import org.joda.time.DateTime
import play.api.libs.json.{JsValue, Json, OFormat}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLClient, SQLDAO}

import scala.concurrent.ExecutionContext

case class TimeSpanRequest(users: List[String], start: Long, end: Long)
object TimeSpanRequest { implicit val timeSpanRequest: OFormat[TimeSpanRequest] = Json.format[TimeSpanRequest] }

case class TimeSpan(
    _id: ObjectId,
    _user: ObjectId,
    _annotation: Option[ObjectId],
    time: Long,
    lastUpdate: Long,
    numberOfUpdates: Long = 0,
    created: Long = System.currentTimeMillis(),
    isDeleted: Boolean = false
) {
  def createdAsDateTime = new DateTime(created)

  def addTime(duration: Long, timestamp: Long): TimeSpan =
    this.copy(lastUpdate = timestamp, time = time + duration, numberOfUpdates = this.numberOfUpdates + 1)
}

object TimeSpan {

  def groupByMonth(timeSpan: TimeSpan): Month =
    Month(timeSpan.createdAsDateTime.getMonthOfYear, timeSpan.createdAsDateTime.getYear)

  def groupByWeek(timeSpan: TimeSpan): Week =
    Week(timeSpan.createdAsDateTime.getWeekOfWeekyear, timeSpan.createdAsDateTime.getWeekyear)

  def groupByDay(timeSpan: TimeSpan): Day =
    Day(timeSpan.createdAsDateTime.getDayOfMonth,
        timeSpan.createdAsDateTime.getMonthOfYear,
        timeSpan.createdAsDateTime.getYear)

  def createFrom(start: Long, end: Long, _user: ObjectId, _annotation: Option[ObjectId]): TimeSpan =
    TimeSpan(ObjectId.generate, _user, _annotation, time = end - start, lastUpdate = end, created = start)

}

class TimeSpanDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SQLDAO[TimeSpan, TimespansRow, Timespans](sqlClient) {
  val collection = Timespans
  val MAX_TIMESTAMP = 253370761200000L

  def idColumn(x: Timespans): Rep[String] = x._Id
  def isDeletedColumn(x: Timespans): Rep[Boolean] = x.isdeleted

  def parse(r: TimespansRow): Fox[TimeSpan] =
    Fox.successful(
      TimeSpan(
        ObjectId(r._Id),
        ObjectId(r._User),
        r._Annotation.map(ObjectId(_)),
        r.time,
        r.lastupdate.getTime,
        r.numberofupdates,
        r.created.getTime,
        r.isdeleted
      ))

  def findAllByUser(userId: ObjectId, start: Option[Long], end: Option[Long]): Fox[List[TimeSpan]] =
    for {
      r <- run(
        Timespans
          .filter(r =>
            notdel(r) && r._User === userId.id && (r.created >= new java.sql.Timestamp(start.getOrElse(0))) && r.created <= new java.sql.Timestamp(
              end.getOrElse(MAX_TIMESTAMP)))
          .result)
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def findAllByUserWithTask(userId: ObjectId, start: Option[Long], end: Option[Long]): Fox[JsValue] =
    for {
      tuples <- run(
        sql"""select ts.time, ts.created, a._id, ts._id, t._id, p.name, tt._id, tt.summary
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

  private def formatTimespanTuples(
      tuples: Vector[(Long, java.sql.Timestamp, String, String, String, String, String, String)]) = {

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

  def findAllByAnnotation(annotationId: ObjectId, start: Option[Long], end: Option[Long]): Fox[List[TimeSpan]] =
    for {
      r <- run(
        Timespans
          .filter(
            r =>
              notdel(r) && r._Annotation === annotationId.id && (r.created >= new java.sql.Timestamp(
                start.getOrElse(0))) && r.created <= new java.sql.Timestamp(end.getOrElse(MAX_TIMESTAMP)))
          .result)
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def findAll(start: Option[Long], end: Option[Long], organizationId: ObjectId): Fox[List[TimeSpan]] =
    for {
      r <- run(sql"""select #${columnsWithPrefix("t.")} from #$existingCollectionName t
              join webknossos.users u on t._user = u._id
              where t.created >= ${new java.sql.Timestamp(start.getOrElse(0))} and t.created <= ${new java.sql.Timestamp(
        end.getOrElse(MAX_TIMESTAMP))}
              and u._organization = $organizationId
          """.as[TimespansRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def insertOne(t: TimeSpan): Fox[Unit] =
    for {
      _ <- run(
        sqlu"""insert into webknossos.timespans(_id, _user, _annotation, time, lastUpdate, numberOfUpdates, created, isDeleted)
                values(${t._id.id}, ${t._user.id}, ${t._annotation.map(_.id)}, ${t.time}, ${new java.sql.Timestamp(
          t.lastUpdate)}, ${t.numberOfUpdates}, ${new java.sql.Timestamp(t.created)}, ${t.isDeleted})""")
    } yield ()

  def updateOne(t: TimeSpan): Fox[Unit] =
    for { //note that t.created is skipped
      _ <- run(sqlu"""update webknossos.timespans
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
