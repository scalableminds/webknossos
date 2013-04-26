package models.knowledge

import models.basics.DAOCaseClass
import models.basics.BasicDAO
import brainflight.tools.geometry.Point3D
import org.bson.types.ObjectId
import com.mongodb.casbah.commons.MongoDBObject
import play.api.libs.json._
import play.api.libs.functional.syntax._
import com.novus.salat._
import models.context._
import scala.util.Random
import com.mongodb.WriteResult

case class MissionInfo(_id: ObjectId, key: String, possibleEnds: List[PossibleEnd]){
  def id = _id.toString
}

case class RenderedStack(
    _level: ObjectId,
    mission: MissionInfo,
    downloadUrls: List[String],
    _id: ObjectId = new ObjectId) extends DAOCaseClass[RenderedStack] {

  val dao = RenderedStack
  lazy val id = _id.toString

}

object RenderedStack extends BasicDAO[RenderedStack]("renderedStacks") with CommonFormats with Function4[ObjectId, MissionInfo, List[String], ObjectId, RenderedStack] {

  implicit val missionInfoFormat: Format[MissionInfo] = Json.format[MissionInfo]
  implicit val renderedStackFormat: Format[RenderedStack] = Json.format[RenderedStack]

  def findFor(levelId: ObjectId) = {
    find(MongoDBObject("_level" -> levelId)).toList
  }
  
  def countFor(levelId: ObjectId) = {
    count(MongoDBObject("_level" -> levelId))
  }

  def remove(levelId: ObjectId, missionId: String){
    if (ObjectId.isValid(missionId))
      remove(MongoDBObject("_level" -> levelId, "mission._id" -> new ObjectId(missionId)))
  }

  def removeAllOf(levelId: ObjectId): WriteResult = {
    remove(MongoDBObject("_level" -> levelId))
  }

  def insertUnique(r: RenderedStack) = {
    update(MongoDBObject(
      "mission.key" -> r.mission.key),
      grater[RenderedStack].asDBObject(r), upsert = true, multi = false)
  }

}