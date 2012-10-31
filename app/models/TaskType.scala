package models

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import models.basics.BasicDAO

case class TimeSpan(min: Int, max: Int, maxHard: Int){
  
  override def toString = "%d - %d, Limit: %d".format(min, max, maxHard)
}

case class TaskType(summary: String, description: String, expectedTime: TimeSpan, fileName: Option[String] = None, _id: ObjectId = new ObjectId) {
  def id = _id.toString
}
object TaskType extends BasicDAO[TaskType]("taskTypes") {

}