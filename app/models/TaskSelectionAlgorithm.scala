package models

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import models.basics.BasicDAO
import java.util.Date
import play.api.libs.json.Writes
import play.api.libs.json.Json

case class TaskSelectionAlgorithm(js: String, active: Boolean = true, timestamp: Date = new Date, _id: ObjectId = new ObjectId){
  val id = _id.toString
  def isValidAlgorithm = TaskSelectionAlgorithm.isValidAlgorithm(js)
}

object TaskSelectionAlgorithm extends BasicDAO[TaskSelectionAlgorithm]("taskAlgorithms") {
  def current = {
    find(MongoDBObject("active" -> true))
      .sort(orderBy = MongoDBObject("timestamp" -> -1))
      .toList
      .headOption getOrElse (throw new Exception("No active task selection algorithm found!"))
  }
  
  def use(alg: TaskSelectionAlgorithm) {
    update(MongoDBObject.empty, MongoDBObject("active" -> false), false, true)
    update(MongoDBObject("_id" -> alg._id), MongoDBObject("active" -> true))
  }

  def isValidAlgorithm(js: String) = true // TODO: implement testing strategie
  
  implicit object TaskSelectionAlgorithmFormat extends Writes[TaskSelectionAlgorithm] {
    def writes(e: TaskSelectionAlgorithm) = Json.obj(
      "id" -> e.id,
      "js" -> e.js,
      "active" -> e.active)
  }
}