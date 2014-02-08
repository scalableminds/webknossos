package models.task

import models.basics.SecuredBaseDAO
import java.util.Date
import play.api.libs.json.Writes
import play.api.libs.json.Json
import braingames.reactivemongo.DBAccessContext
import reactivemongo.bson.BSONObjectID
import play.modules.reactivemongo.json.BSONFormats._
import play.api.libs.concurrent.Execution.Implicits._

case class TaskSelectionAlgorithm(js: String, isActive: Boolean = true, timestamp: Date = new Date, _id: BSONObjectID = BSONObjectID.generate) {
  val id = _id.stringify

  def isValidAlgorithm = TaskSelectionAlgorithm.isValidAlgorithm(js)
}

object TaskSelectionAlgorithm {
  implicit val taskSelectionAlgorithmFormat = Json.format[TaskSelectionAlgorithm]

  // TODO: implement testing strategie
  def isValidAlgorithm(js: String) = true
}

object TaskSelectionAlgorithmDAO extends SecuredBaseDAO[TaskSelectionAlgorithm] {

  val collectionName = "taskAlgorithms"
  val formatter = TaskSelectionAlgorithm.taskSelectionAlgorithmFormat

  def current(implicit ctx: DBAccessContext) = {
    collectionFind(Json.obj("isActive" -> true))
    .sort(Json.obj("timestamp" -> -1))
    .one[TaskSelectionAlgorithm].map {
      case Some(a) => a
      case _ => throw new Exception("No active task selection algorithm found!")
    }
  }

  def use(alg: TaskSelectionAlgorithm)(implicit ctx: DBAccessContext) {
    collectionUpdate(
      Json.obj("_id" -> Json.obj("$ne" -> alg._id)),
      Json.obj("$set" -> Json.obj("isActive" -> false)),
      multi = true)
    collectionUpdate(
      Json.obj("_id" -> alg._id),
      Json.obj("$set" -> Json.obj("isActive" -> true)))
  }

  implicit object TaskSelectionAlgorithmFormat extends Writes[TaskSelectionAlgorithm] {
    def writes(e: TaskSelectionAlgorithm) = Json.obj(
      "id" -> e.id,
      "js" -> e.js,
      "isActive" -> e.isActive)
  }

}