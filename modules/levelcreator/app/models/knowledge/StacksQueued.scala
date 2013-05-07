package models.knowledge

import models.basics.BasicDAO
import com.mongodb.casbah.Imports._
import com.novus.salat.annotations._
import play.api.Logger

object StacksQueued extends BasicDAO[Stack]("stacksQueued") {
  this.collection.ensureIndex(MongoDBObject("level.levelId" -> 1, "mission._id" -> 1))

  def popOne() = {
    findOne(MongoDBObject.empty).map { e =>
      removeById(e._id)
      e
    }
  }

  def remove(level: Level, mission: Mission): WriteResult = {
    remove(MongoDBObject(
      "level.levelId.name" -> level.levelId.name,
      "level.levelId.version" -> level.levelId.version,
      "mission._id" -> mission._id))
  }

  def findFor(levelId: LevelId) = {
    find(MongoDBObject(
      "level.levelId.name" -> levelId.name,
      "level.levelId.version" -> levelId.version)).toList
  }

  def find(level: Level, mission: Mission): List[Stack] = {
    find(MongoDBObject(
      "level.levelId.name" -> level.levelId.name,
      "level.levelId.version" -> level.levelId.version,
      "mission._id" -> mission._id)).toList
  }
}