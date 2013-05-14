package models.knowledge

import models.basics.BasicDAO
import org.bson.types.ObjectId
import play.api.libs.json.Format
import play.api.libs.json._
import play.api.libs.functional.syntax._
import models.basics.DAOCaseClass
import scala.concurrent.duration.FiniteDuration
import com.mongodb.casbah.commons.MongoDBObject

case class StackRenderingChallenge(key: String, _level: LevelId, _mission: ObjectId, timestamp: Long = System.currentTimeMillis, _id: ObjectId = new ObjectId) extends DAOCaseClass[StackRenderingChallenge] {
  val id = _id.toString
  val dao = StacksInProgress

  def level = Level.findOneById(_level)

  def mission = Mission.findOneById(_mission)
}

object StacksInProgress extends BasicDAO[StackRenderingChallenge]("stacksInProgress") {
  this.collection.ensureIndex("key")
  this.collection.ensureIndex(MongoDBObject("_level" -> 1, "_mission" -> 1))

  def findAllOlderThan(d: FiniteDuration) = {
    val t = System.currentTimeMillis() - d.toMillis
    find(MongoDBObject("timestamp" -> MongoDBObject("$lt" -> t))).toList
  }

  def findOneByKey(key: String) = {
    findOne(MongoDBObject("key" -> key))
  }

  def findFor(levelId: LevelId) = {
    find(MongoDBObject(
      "_level.name" -> levelId.name,
      "_level.version" -> levelId.version)).toList
  }

  def find(level: Level, mission: Mission): List[StackRenderingChallenge] = {
    find(MongoDBObject(
      "_level.name" -> level.levelId.name,
      "_level.version" -> level.levelId.version,
      "_mission" -> mission._id)).toList
  }
}