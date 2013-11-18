package models.annotation

import org.bson.types.ObjectId
import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import models.basics.BasicDAO
import models.user.{UserService, User}
import java.util.Date

case class AnnotationReview(
    _reviewer: ObjectId,
    reviewAnnotation: ObjectId,
    timestamp: Long,
    comment: Option[String] = None,
    _id: ObjectId = new ObjectId) {

  def reviewer = UserService.findOneById(_reviewer.toString, useCache = true)
  
  val date = new Date(timestamp)
}