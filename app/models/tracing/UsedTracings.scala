package models.tracing

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import models.basics.BasicDAO
import models.user.User

case class UsedTracings(user: ObjectId, tracing: String, _id: ObjectId = new ObjectId)

object UsedTracings extends BasicDAO[UsedTracings]("usedTracings") {
  def use(user: User, tracingId: String) {
    removeAll(user)
    insertOne(UsedTracings(user._id, tracingId))
  }
  
  def by(user: User) = 
    find( MongoDBObject("user" -> user._id)).map(_.tracing).toList
  
  def removeAll(user: User) {
    remove(MongoDBObject("user" -> user._id))
  }
  
  def removeAll(tracingId: ObjectId) {
    remove(MongoDBObject("tracing" -> tracingId))
  }
}