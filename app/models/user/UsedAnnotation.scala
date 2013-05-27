package models.user

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import models.basics.BasicDAO

case class UsedAnnotation(user: ObjectId, tracing: String, _id: ObjectId = new ObjectId)

object UsedAnnotation extends BasicDAO[UsedAnnotation]("usedAnnotations") {
  def use(user: User, tracingId: String) {
    removeAll(user)
    insertOne(UsedAnnotation(user._id, tracingId))
  }
  
  def by(user: User) = 
    find( MongoDBObject("user" -> user._id)).map(_.tracing).toList
  
  def removeAll(user: User) {
    remove(MongoDBObject("user" -> user._id))
  }
  
  def removeAll(tracing: String) {
    remove(MongoDBObject("tracing" -> tracing))
  }
}