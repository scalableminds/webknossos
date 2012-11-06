package models.task

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import models.basics.BasicDAO

case class TimeSpan(min: Int, max: Int, maxHard: Int){
  
  override def toString = "%d - %d, Limit: %d".format(min, max, maxHard)
}

case class TaskType(summary: String, description: String, expectedTime: TimeSpan, fileName: Option[String] = None, _id: ObjectId = new ObjectId) {
  lazy val id = _id.toString
}
object TaskType extends BasicDAO[TaskType]("taskTypes") {
  def empty = TaskType("","",TimeSpan(5, 10, 15))
  
  def fromForm(summary: String, description: String, expectedTime: TimeSpan) = 
    TaskType(summary, description, expectedTime)
    
  def toForm(tt: TaskType) =
    Some(tt.summary, tt.description, tt.expectedTime)
}