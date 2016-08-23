package models.mturk

import play.api.libs.json.Json
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._

/**
  * Mapping between a user (created for each mturk worker), an assignment (HIT assignment id) and the created
  * annotation on webknossos.
  *
  * @param _annotation  wk annotation
  * @param _user        wk user (usually anonymous, one for each worker)
  * @param assignmentId assignment id of a HIT instance
  */
case class MTurkAnnotationReference(_annotation: BSONObjectID, _user: BSONObjectID, assignmentId: String)

object MTurkAnnotationReference {
  implicit val mturkAnnotationReferenceFormat = Json.format[MTurkAnnotationReference]
}
