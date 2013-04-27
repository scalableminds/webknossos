package models.knowledge

import models.basics.BasicDAO
import com.mongodb.casbah.Imports._
import com.novus.salat.annotations._

object StacksQueued extends BasicDAO[Stack]("stacksQueued"){
  this.collection.ensureIndex(MongoDBObject("level._id" -> 1, "mission._id" -> 1))
  
  
  def popOne() = {
    findOne(MongoDBObject.empty).map{ e =>
      removeById(e._id)
      e
    }
  }
  
  def remove(level: Level, mission: Mission): WriteResult = {
    remove(MongoDBObject("level._id" -> level._id, "mission._id" -> mission._id))
  }
  
  def findFor(levelId: ObjectId) = {
    find(MongoDBObject("level._id" -> levelId)).toList
  }
  
  def find(level: Level, mission: Mission): List[Stack] = {
    find(MongoDBObject("level._id" -> level._id, "mission._id" -> mission._id)).toList
  }
}