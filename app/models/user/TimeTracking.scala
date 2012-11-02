package models.user

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import models.basics.BasicDAO
import java.util.Date
import java.util.Calendar
import akka.util.duration._

case class TimeEntry(time: Long, timestamp: Long) {
  val created = {
    new Date(timestamp)
  }
}

case class PaymentInterval(month: Int, year: Int){
  override def toString = "%d/%d".format(month, year)
}

case class TimeTracking(user: ObjectId, timeEntries: List[TimeEntry], _id: ObjectId = new ObjectId) {

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
}

object TimeTracking extends BasicDAO[TimeTracking]("timeTracking") {
  import akka.util.duration._
  val MAX_PAUSE = (5 minutes).toMillis
  
  def emptyTracking(user: User) = TimeTracking(user._id, Nil)

  def loggedTime(user: User) = {
    findOneByUser(user).map(_.splitIntoMonths)
  }

  def findOneByUser(user: User) =
    findOne(MongoDBObject("user" -> user._id))

  def logUserAction(user: User) = {
    val current = System.currentTimeMillis
    findOneByUser(user) match {
      case Some(timeTracker) =>
        timeTracker.timeEntries match{
          case lastEntry :: tail if current - lastEntry.timestamp < MAX_PAUSE =>
            val entry = TimeEntry(lastEntry.time + current - lastEntry.timestamp, current )
            alterAndSave(timeTracker.copy(timeEntries = entry :: tail))
          case _ =>
            val entry = TimeEntry(0, current)
            alterAndSave(timeTracker.copy(timeEntries = entry :: timeTracker.timeEntries))
        }
      case _ =>
        val entry = TimeEntry(0, current)
        alterAndInsert(TimeTracking(user._id, List(entry)))
    }
  }
}