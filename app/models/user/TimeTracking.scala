package models.user

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import models.basics.BasicDAO
import java.util.Date
import java.util.Calendar
import scala.concurrent.duration._
import models.basics.DAOCaseClass
import braingames.util.ExtendedTypes.ExtendedString
import oxalis.thirdparty.BrainTracing
import models.annotation.{AnnotationLike, Annotation}
import models.tracing.skeleton.SkeletonTracing
import models.task.Task

case class TimeEntry(time: Long, timestamp: Long, note: Option[String] = None, annotation: Option[String] = None) {
  val created = {
    new Date(timestamp)
  }

  def annotationEquals(other: String): Boolean =
    annotationEquals(Some(other))

  def annotationEquals(other: Option[String]): Boolean = {
    annotation == other
  }
}

case class PaymentInterval(month: Int, year: Int) {
  override def toString = "%d/%d".format(month, year)
}

case class TimeTracking(user: ObjectId, timeEntries: List[TimeEntry], _id: ObjectId = new ObjectId) extends DAOCaseClass[TimeTracking] {

  val dao = TimeTracking

  def sum(from: Date, to: Date) = {
    timeEntries.filter(t => t.created.after(from) && t.created.before(to)).foldLeft(0L)(_ + _.time)
  }

  def splitIntoMonths = {
    val cal = Calendar.getInstance
    timeEntries.groupBy { t =>
      cal.setTime(t.created)
      PaymentInterval(cal.get(Calendar.MONTH) + 1, cal.get(Calendar.YEAR))
    }.map {
      case (pI, entries) => (pI, entries.foldLeft(0L)(_ + _.time) millis)
    }
  }

  def addTimeEntry(entry: TimeEntry) =
    this.copy(timeEntries = entry :: this.timeEntries)

  def setTimeEntries(entries: List[TimeEntry]) =
    this.copy(timeEntries = entries)
}

object TimeTracking extends BasicDAO[TimeTracking]("timeTracking") {
  val MAX_PAUSE = (5 minutes).toMillis

  val timeRx = "(([0-9]+)d)?(\\s*([0-9]+)h)?(\\s*([0-9]+)m)?".r

  val hoursRx = "[0-9]+".r

  def emptyTracking(user: User) = TimeTracking(user._id, Nil)

  def loggedTime(user: User) = {
    findOneByUser(user).map(_.splitIntoMonths)
  }

  def logTime(user: User, time: Long, note: String) = {
    val current = System.currentTimeMillis
    val entry = TimeEntry(time, current, note = Option(note))
    findOneByUser(user) match {
      case Some(timeTracker) =>
        timeTracker.update(_.addTimeEntry(entry))
      case _ =>
        insertOne(TimeTracking(user._id, List(entry)))
    }
  }

  def findOneByUser(user: User) =
    findOne(MongoDBObject("user" -> user._id))

  def parseTime(s: String) = {
    s match {
      case timeRx(_, d, _, h, _, m) if d != null || h != null || m != null =>
        Some(inMillis(d, h, m))
      case hoursRx(h) if h != null =>
        Some(inMillis("0", h, "0"))
      case _ =>
        None
    }
  }

  def inMillis(d: String, h: String, m: String) = {
    val ds = d.toIntOpt.getOrElse(0)
    val hs = h.toIntOpt.getOrElse(0)
    val ms = m.toIntOpt.getOrElse(0)

    ((ds * 24 + hs) * 60 + ms) * 60000L
  }

  def logTimeToTask(time: Long, taskOpt: Option[Task]) = {
    taskOpt.map(task => Task.logTime(time, task))
  }

  def logUserAction(user: User, annotation: AnnotationLike): TimeTracking =
    logUserAction(user, Some(annotation))

  def logUserAction(user: User, annotation: Option[AnnotationLike]): TimeTracking = {
    val current = System.currentTimeMillis
    findOneByUser(user) match {
      case Some(timeTracker) =>
        timeTracker.timeEntries match {
          case lastEntry :: tail if current - lastEntry.timestamp < MAX_PAUSE && lastEntry.annotationEquals(annotation.map(_.id)) =>
            val time = current - lastEntry.timestamp
            BrainTracing.logTime(user, lastEntry.copy(time = time, timestamp = current))
            logTimeToTask(time, annotation.flatMap(_.task))
            val accumulated = lastEntry.copy(time = lastEntry.time + time, timestamp = current)
            timeTracker.update(_.setTimeEntries(accumulated :: tail))
          case _ =>
            val entry = TimeEntry(0, current, annotation = annotation.map(_.id))
            timeTracker.update(_.addTimeEntry(entry))
        }
      case _ =>
        val entry = TimeEntry(0, current, annotation = annotation.map(_.id))
        insertOne(TimeTracking(user._id, List(entry)))
    }
  }
}