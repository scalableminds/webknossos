package models.task

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import models.basics.BasicDAO
import models.tracing.TracingSettings
import play.api.libs.json.Json
import play.api.libs.functional.syntax._

case class TimeSpan(min: Int, max: Int, maxHard: Int) {

  override def toString = s"$min - $max, Limit: $maxHard"
}

case class TaskType(summary: String, description: String, expectedTime: TimeSpan, tracingSettings: TracingSettings = TracingSettings.default, fileName: Option[String] = None, _id: ObjectId = new ObjectId) {
  lazy val id = _id.toString
}

object TaskType extends BasicDAO[TaskType]("taskTypes") {
  def empty = TaskType("", "", TimeSpan(5, 10, 15))

  def fromForm(summary: String, description: String, allowedModes: Seq[String], branchPointsAllowed: Boolean, somaClickingAllowed: Boolean, expectedTime: TimeSpan) =
    TaskType(
      summary,
      description,
      expectedTime,
      TracingSettings(
        allowedModes.toList,
        branchPointsAllowed,
        somaClickingAllowed))

  def toForm(tt: TaskType) =
    Some((
        tt.summary, 
        tt.description, 
        tt.tracingSettings.allowedModes, 
        tt.tracingSettings.branchPointsAllowed, 
        tt.tracingSettings.somaClickingAllowed,
        tt.expectedTime))

  def findOneBySumnary(summary: String) = {
    findOne(MongoDBObject("summary" -> summary))
  }
}