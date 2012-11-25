package models.tracing

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import models.basics.BasicDAO
import models.user.User

case class UsedTracings(user: ObjectId, tracing: ObjectId, _id: ObjectId = new ObjectId)

object UsedTracings extends BasicDAO[UsedTracings]("usedTracings") {
  def use(user: User, tracing: Tracing) {
    removeAll(user)
    insertOne(UsedTracings(user._id, tracing._id))
  }
  
  def by(user: User) = 
    find( MongoDBObject("user" -> user._id)).map(_.tracing).toList
  
  def removeAll(user: User) {
    UsedTracings.remove(MongoDBObject("user" -> user._id))
  }
  
  def removeAll(tracing: Tracing) {
    find(MongoDBObject("tracing" -> tracing._id)).toList.foreach(UsedTracings.remove)
  }
}