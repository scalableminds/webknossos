package models

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import models.basics.BasicDAO

case class TimeSpan( min: Int, max: Int, maxHard: Int)

case class TaskType( description: String, experiment: String, expectedTime: TimeSpan, fileName: Option[String], _id : ObjectId = new ObjectId)

object TaskType extends BasicDAO[TaskType]("taskTypes"){
  
}