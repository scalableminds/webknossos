package models.annotation

import models.user.{UserService, User}
import java.util.Date
import play.api.libs.json.Json
import play.modules.reactivemongo.json.BSONFormats._
import reactivemongo.bson.BSONObjectID
import braingames.reactivemongo.GlobalAccessContext

case class AnnotationReview(
    _reviewer: BSONObjectID,
    reviewAnnotation: BSONObjectID,
    timestamp: Long,
    comment: Option[String] = None,
    _id: BSONObjectID = BSONObjectID.generate) {

  def reviewer = UserService.findOneById(_reviewer.toString, useCache = true)(GlobalAccessContext)
  
  val date = new Date(timestamp)
}

object AnnotationReview {
	implicit val annotationReviewFormat = Json.format[AnnotationReview]
}