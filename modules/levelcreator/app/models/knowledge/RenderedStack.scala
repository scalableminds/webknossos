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
    level: LevelId,
    mission: MissionInfo,
    downloadUrls: List[String],
    _id: ObjectId = new ObjectId) extends DAOCaseClass[RenderedStack] {

  val dao = RenderedStack
  lazy val id = _id.toString

}

object RenderedStack extends BasicDAO[RenderedStack]("renderedStacks") with CommonFormats with Function4[LevelId, MissionInfo, List[String], ObjectId, RenderedStack] {
  import Level.levelIdFormat
  implicit val missionInfoFormat: Format[MissionInfo] = Json.format[MissionInfo]
  implicit val renderedStackFormat: Format[RenderedStack] = Json.format[RenderedStack]

  def findFor(levelId: LevelId) = {
    find(MongoDBObject("level" -> levelId)).toList
  }
  
  def countFor(levelId: LevelId) = {
    count(MongoDBObject("level" -> levelId))
  }

  def remove(levelId: LevelId, missionOId: String){
    if (ObjectId.isValid(missionOId))
      remove(MongoDBObject("level" -> levelId, "mission._id" -> new ObjectId(missionOId)))
  }
  
  def removeAllOfMission(missionOId: String) = {
    if (ObjectId.isValid(missionOId))
      remove(MongoDBObject( "mission._id" ->  new ObjectId(missionOId)))
  }
  
  def removeAllOf(levelId: LevelId): WriteResult = {
    remove(MongoDBObject("level" -> levelId))
  }
  
  def updateOrCreate(r: RenderedStack) =
    findOne(MongoDBObject(
      "level" -> r.level,
      "mission.key" -> r.mission.key)) match {
      case Some(stored) =>
        stored.update(_ => r.copy(_id = stored._id))
        stored._id
      case _ =>
        insertOne(r)
        r._id
    }
}