package models.user.time

import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import models.annotation.AnnotationState.AnnotationState
import models.annotation.AnnotationType.AnnotationType
import play.api.libs.json.{JsArray, JsObject, JsValue, Json}
import slick.lifted.Rep
import utils.sql.{SQLDAO, SqlClient, SqlToken}
import com.scalableminds.util.objectid.ObjectId

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

case class TimeSpan(
    _id: ObjectId,
    _user: ObjectId,
    _annotation: Option[ObjectId], // Optional for compatibility with legacy data. All new timespans have an annotation.
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

  def fromInstant(timestamp: Instant, userId: ObjectId, annotationId: ObjectId): TimeSpan =
    TimeSpan(ObjectId.generate, userId, Some(annotationId), time = 0L, lastUpdate = timestamp, created = timestamp)

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

  def findAllByUser(userId: ObjectId): Fox[List[TimeSpan]] =
    for {
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE _user = $userId".as[TimespansRow])
      parsed <- parseAll(r)
    } yield parsed

  def summedByAnnotationForUser(userId: ObjectId,
                                start: Instant,
                                end: Instant,
                                annotationTypes: List[AnnotationType],
                                annotationStates: List[AnnotationState],
                                projectIds: List[ObjectId]): Fox[JsValue] =
    if (annotationTypes.isEmpty) Fox.successful(Json.arr())
    else {
      val projectQuery = projectIdsFilterQuery(projectIds)
      for {
        tuples <- run(
          q"""WITH timeSummedPerAnnotation AS (
                SELECT a._id AS _annotation, t._id AS _task, p.name AS projectName, SUM(ts.time) AS timeSummed
                FROM webknossos.timespans_ ts
                JOIN webknossos.annotations_ a ON ts._annotation = a._id
                LEFT JOIN webknossos.tasks_ t ON a._task = t._id
                LEFT JOIN webknossos.projects_ p ON t._project = p._id
                WHERE ts._user = $userId
                AND ts.time > 0
                AND ts.created >= $start
                AND ts.created < $end
                AND $projectQuery
                AND a.typ IN ${SqlToken.tupleFromList(annotationTypes)}
                AND a.state IN ${SqlToken.tupleFromList(annotationStates)}
                GROUP BY a._id, t._id, p.name
              )
              SELECT ti._annotation, ti._task, ti.projectName, ti.timeSummed, JSON_AGG(al.statistics) AS layerStatistics
              FROM timeSummedPerAnnotation ti
              JOIN webknossos.annotation_layers al ON al._annotation = ti._annotation
              GROUP BY ti._annotation, ti._task, ti.projectName, ti.timeSummed
              ORDER BY ti._annotation
          """.as[(String, Option[String], Option[String], Long, String)]
        )
        parsed = tuples.map { t =>
          val layerStats: JsArray = Json.parse(t._5).validate[JsArray].getOrElse(Json.arr())
          Json.obj(
            "annotation" -> t._1,
            "task" -> t._2,
            "projectName" -> t._3,
            "timeMillis" -> t._4,
            "annotationLayerStats" -> layerStats
          )
        }
      } yield Json.toJson(parsed)
    }

  def findAllByUserWithTask(userId: ObjectId,
                            start: Instant,
                            end: Instant,
                            annotationTypes: List[AnnotationType],
                            annotationStates: List[AnnotationState],
                            projectIds: List[ObjectId]): Fox[JsValue] =
    if (annotationTypes.isEmpty) Fox.successful(Json.arr())
    else {
      val projectQuery = projectIdsFilterQuery(projectIds)
      for {
        tuples <- run(
          q"""SELECT ts._user, mu.email, o._id, d.name, a._id, a.state, t._id, p.name, tt._id, tt.summary, ts._id, ts.created, ts.time
              FROM webknossos.timespans_ ts
              JOIN webknossos.annotations_ a on ts._annotation = a._id
              JOIN webknossos.users_ u on ts._user = u._id
              JOIN webknossos.multiUsers_ mu on u._multiUser = mu._id
              JOIN webknossos.datasets_ d on a._dataset = d._id
              JOIN webknossos.organizations_ o on d._organization = o._id
              LEFT JOIN webknossos.tasks_ t on a._task = t._id
              LEFT JOIN webknossos.projects_ p on t._project = p._id
              LEFT JOIN webknossos.taskTypes_ tt on t._taskType = tt._id
              WHERE ts._user = $userId
              AND ts.time > 0
              AND ts.created >= $start
              AND ts.created < $end
              AND $projectQuery
              AND a.typ IN ${SqlToken.tupleFromList(annotationTypes)}
              AND a.state IN ${SqlToken.tupleFromList(annotationStates)}
            """.as[(String,
                    String,
                    String,
                    String,
                    String,
                    String,
                    Option[String],
                    Option[String],
                    Option[String],
                    Option[String],
                    String,
                    Instant,
                    Long)])
      } yield Json.toJson(tuples.map(formatTimespanTuple))
    }

  private def formatTimespanTuple(
      tuple: (String,
              String,
              String,
              String,
              String,
              String,
              Option[String],
              Option[String],
              Option[String],
              Option[String],
              String,
              Instant,
              Long)) =
    Json.obj(
      "userId" -> tuple._1,
      "userEmail" -> tuple._2,
      "datasetOrganization" -> tuple._3,
      "datasetName" -> tuple._4,
      "annotationId" -> tuple._5,
      "annotationState" -> tuple._6,
      "taskId" -> tuple._7,
      "projectName" -> tuple._8,
      "taskTypeId" -> tuple._9,
      "taskTypeSummary" -> tuple._10,
      "timeSpanId" -> tuple._11,
      "timeSpanCreated" -> tuple._12,
      "timeSpanTimeMillis" -> tuple._13
    )

  private def projectIdsFilterQuery(projectIds: List[ObjectId]): SqlToken =
    if (projectIds.isEmpty) q"TRUE" // Query did not filter by project, include all
    else q"p._id IN ${SqlToken.tupleFromList(projectIds)}"

  def timeOverview(start: Instant,
                   end: Instant,
                   users: List[ObjectId],
                   annotationTypes: List[AnnotationType],
                   annotationStates: List[AnnotationState],
                   projectIds: List[ObjectId]): Fox[List[JsObject]] =
    if (users.isEmpty || annotationTypes.isEmpty) Fox.successful(List.empty)
    else {
      val projectQuery = projectIdsFilterQuery(projectIds)
      val query =
        q"""
          SELECT u._id, u.firstName, u.lastName, mu.email, SUM(ts.time), COUNT(DISTINCT a._id)
          FROM webknossos.timespans_ ts
          JOIN webknossos.annotations_ a ON ts._annotation = a._id
          JOIN webknossos.users_ u ON ts._user = u._id
          JOIN webknossos.multiusers_ mu ON u._multiuser = mu._id
          LEFT JOIN webknossos.tasks_ t ON a._task = t._id
          LEFT JOIN webknossos.projects_ p ON t._project = p._id -- no fanout effect because every annotation can have at most one task and project
          WHERE $projectQuery
          AND u._id IN ${SqlToken.tupleFromList(users)}
          AND a.typ IN ${SqlToken.tupleFromList(annotationTypes)}
          AND a.state IN ${SqlToken.tupleFromList(annotationStates)}
          AND ts.time > 0
          AND ts.created >= $start
          AND ts.created < $end
          GROUP BY u._id, u.firstName, u.lastName, mu.email
         """
      for {
        tuples <- run(query.as[(ObjectId, String, String, String, Long, Int)])
      } yield formatSummedSearchTuples(tuples)
    }

  private def formatSummedSearchTuples(tuples: Seq[(ObjectId, String, String, String, Long, Int)]): List[JsObject] =
    tuples.map { tuple =>
      Json.obj(
        "user" -> Json.obj(
          "id" -> tuple._1,
          "firstName" -> tuple._2,
          "lastName" -> tuple._3,
          "email" -> tuple._4
        ),
        "timeMillis" -> tuple._5,
        "annotationCount" -> tuple._6
      )
    }.toList

  def insertOne(t: TimeSpan): Fox[Unit] =
    for {
      _ <- run(
        q"""INSERT INTO webknossos.timespans(_id, _user, _annotation, time, lastUpdate, numberOfUpdates, created, isDeleted)
                VALUES(${t._id}, ${t._user}, ${t._annotation}, ${t.time}, ${t.lastUpdate},
                ${t.numberOfUpdates}, ${t.created}, ${t.isDeleted})""".asUpdate)
    } yield ()

  def updateOne(t: TimeSpan): Fox[Unit] =
    for { //note that t.created is skipped
      _ <- run(q"""UPDATE webknossos.timespans
                   SET
                    _user = ${t._user},
                    _annotation = ${t._annotation},
                    time = ${t.time},
                    lastUpdate = ${t.lastUpdate},
                    numberOfUpdates = ${t.numberOfUpdates},
                    isDeleted = ${t.isDeleted}
                  WHERE _id = ${t._id}
        """.asUpdate)
    } yield ()
}
