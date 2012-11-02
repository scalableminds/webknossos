package models.user

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import models.basics.BasicDAO
import java.util.Date
import java.util.Calendar

case class TimeEntry(time: Int, created: Date)

case class PaymentInterval(month: Int, year: Int)

case class TimeTracking(user: ObjectId, timeEntries: List[TimeEntry], _id: ObjectId = new ObjectId) {
  def logTime(time: Int) = {
    val entry = TimeEntry(time, new Date())
    copy(timeEntries = entry :: timeEntries)
  }

  def sum(from: Date, to: Date) = {
    timeEntries.filter(t => t.created.after(from) && t.created.before(to)).foldLeft(0)(_ + _.time)
  }

  def splitIntoMonths = {
    val cal = Calendar.getInstance
    timeEntries.groupBy { t =>
      cal.setTime(t.created)
      PaymentInterval(cal.get(Calendar.MONTH),cal.get(Calendar.YEAR))
    }.map {
      case (pI, entries) => (pI, entries.foldLeft(0)(_ + _.time))
    }
  }
}

object TimeTracking extends BasicDAO[TimeTracking]("timeTracking") {

  def emptyTracking(user: User) = TimeTracking(user._id, Nil)
  
  def loggedTime(user: User) = {
    findOneByUser(user).map(_.splitIntoMonths)
  }

  def findOneByUser(user: User) = 
    findOne(MongoDBObject("user" -> user._id))
  
  def logTime(user: User, time: Int) = {
    findOneByUser(user)
      .orElse(Some(emptyTracking(user)))
      .map(tt => save(tt.logTime(time)))
  }
}