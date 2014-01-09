package models.user.time

import com.mongodb.casbah.Imports._
import models.basics.BasicReactiveDAO
import java.util.Date
import java.util.Calendar
import scala.concurrent.duration._
import braingames.util.ExtendedTypes.ExtendedString
import oxalis.thirdparty.BrainTracing
import models.annotation.{AnnotationLike, Annotation}
import models.tracing.skeleton.SkeletonTracing
import models.task.Task
import models.user.User
import play.api.Play
import braingames.reactivemongo.DBAccessContext
import reactivemongo.bson.BSONObjectID
import play.api.libs.json.Json
import scala.concurrent.Future
import play.modules.reactivemongo.json.BSONFormats._
import play.api.libs.concurrent.Execution.Implicits._

case class TimeTracking(user: BSONObjectID, timeEntries: List[TimeEntry], _id: BSONObjectID = BSONObjectID.generate){

  def inInterval(after: Date, before: Date) =
    timeEntries.filter(t => t.created.after(after) && t.created.before(before))

  def sum(from: Date, to: Date) =
    inInterval(from, to).foldLeft(0L)(_ + _.time)

  def groupByPaymentIntervals = {
    val cal = Calendar.getInstance
    timeEntries.groupBy {
      entry =>
        cal.setTime(entry.created)
        PaymentInterval(cal.get(Calendar.MONTH) + 1, cal.get(Calendar.YEAR))
    }
  }

  def splitIntoPaymentIntervals = {
    groupByPaymentIntervals.map {
      case (pI, entries) => (pI, entries.foldLeft(0L)(_ + _.time) millis)
    }
  }

  def addTimeEntry(entry: TimeEntry) =
    this.copy(timeEntries = entry :: this.timeEntries)

  def setTimeEntries(entries: List[TimeEntry]) =
    this.copy(timeEntries = entries)
}

object TimeTracking {

  val timeRx = "(([0-9]+)d)?(\\s*([0-9]+)h)?(\\s*([0-9]+)m)?".r

  val hoursRx = "[0-9]+".r

  val hoursPerDay = 24

  val minutesPerHour = 60

  val millisecondsPerMinute = 60000L

  implicit val timeTrackingFormatter = Json.format[TimeTracking]

  def inMillis(days: Int, hours: Int, minutes: Int) =
    ((days * hoursPerDay + hours) * minutesPerHour + minutes) * millisecondsPerMinute

  def parseTime(s: String) = {
    s match {
      case timeRx(_, d, _, h, _, m) if d != null || h != null || m != null =>
        Some(inMillis(d.toInt, h.toInt, m.toInt))
      case hoursRx(h) if h != null =>
        Some(inMillis(0, h.toInt, 0))
      case _ =>
        None
    }
  }
}

object TimeTrackingDAO extends BasicReactiveDAO[TimeTracking] {
  val collectionName = "timeTracking"

  val formatter = TimeTracking.timeTrackingFormatter

  val MaxTracingPause = (Play.current.configuration.getInt("oxalis.user.time.tracingPauseInMinutes") getOrElse (5) minutes).toMillis

  def emptyTracking(user: User) = TimeTracking(user._id, Nil)

  def findOneByUser(user: User)(implicit ctx: DBAccessContext) = findOne("user", toBSONObjectID(user._id))

  def addTimeEntry(timeTracker: TimeTracking, entry: TimeEntry)(implicit ctx: DBAccessContext) =
    collectionUpdate(Json.obj("_id" -> timeTracker._id), Json.obj("$set" -> Json.obj("timeEntries.-1" -> entry)))

  def setTimeEntries(timeTracker: TimeTracking, entries: List[TimeEntry])(implicit ctx: DBAccessContext) =
    collectionUpdate(Json.obj("_id" -> timeTracker._id), Json.obj("$set" -> Json.obj("timeEntries" -> entries)))

  def logTime(user: User, annotation: Option[AnnotationLike])(implicit ctx: DBAccessContext): Future[Long] = {
    val current = System.currentTimeMillis

    findOneByUser(user).map {
      case Some(timeTracker) =>
        appendToTimeTracker(timeTracker, user, annotation)
      case _ =>
        val entry = TimeEntry(0, current, annotation = annotation.map(_.id))
        insertNewForEntry(user, entry)
        entry.time
    }
  }

  def insertNewForEntry(user: User, entry: TimeEntry)(implicit ctx: DBAccessContext) =
    insert(TimeTracking(user._id, List(entry)))

  def logTime(user: User, time: Long, note: Option[String])(implicit ctx: DBAccessContext) = {
    val current = System.currentTimeMillis
    val entry = TimeEntry(time, current, note = note)
    findOneByUser(user).map {
      case Some(timeTracker) =>
        addTimeEntry(timeTracker, entry)
      case _ =>
        insertNewForEntry(user, entry)
    }
    entry.time
  }

  private def isNotInterrupted(current: Long, lastEntry: TimeEntry, annotation: Option[AnnotationLike]) =
    current - lastEntry.timestamp < MaxTracingPause && lastEntry.annotationEquals(annotation.map(_.id))

  private def appendToTimeTracker(timeTracker: TimeTracking, user: User, annotation: Option[AnnotationLike])(implicit ctx: DBAccessContext) = {
    val current = System.currentTimeMillis
    timeTracker.timeEntries match {
      case lastEntry :: tail if isNotInterrupted(current, lastEntry, annotation) =>
        val time = current - lastEntry.timestamp
        setTimeEntries(timeTracker, lastEntry.addTime(time, current) :: tail)
        time
      case _ =>
        addTimeEntry(timeTracker, TimeEntry.create(current, annotation))
        0L
    }
  }
}