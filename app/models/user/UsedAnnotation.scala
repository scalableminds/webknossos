package models.user

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import models.basics.BasicDAO
import oxalis.annotation.AnnotationIdentifier

case class UsedAnnotation(user: ObjectId, annotationId: AnnotationIdentifier, _id: ObjectId = new ObjectId)

object UsedAnnotation extends BasicDAO[UsedAnnotation]("usedAnnotations") {
  def use(user: User, annotationId: AnnotationIdentifier) {
    removeAll(user)
    insertOne(UsedAnnotation(user._id, annotationId))
  }
  
  def by(user: User) = 
    find( MongoDBObject("user" -> user._id)).map(_.annotationId).toList

  def oneBy(user: User) =
    by(user).headOption

  def removeAll(user: User) {
    remove(MongoDBObject("user" -> user._id))
  }
  
  def removeAll(tracing: String) {
    remove(MongoDBObject("tracing" -> tracing))
  }
}