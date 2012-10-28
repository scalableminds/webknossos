package models

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import models.basics.BasicDAO
import java.util.Date

case class TaskSelectionAlgorithm(js: String, timestamp: Date, active: Boolean)

object TaskSelectionAlgorithm extends BasicDAO[TaskSelectionAlgorithm]("taskAlgorithms") {
  def current = {
    find(MongoDBObject("active" -> true))
      .sort(orderBy = MongoDBObject("timestamp" -> -1))
      .toList
      .headOption getOrElse (throw new Exception("No active task selection algorithm found!"))
  }
}