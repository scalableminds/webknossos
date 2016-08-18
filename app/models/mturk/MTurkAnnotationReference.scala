/*
 * Copyright (C) Tom Bocklisch <https://github.com/tmbo>
 */
package models.mturk

import play.api.libs.json.Json
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._

case class MTurkAnnotationReference(_annotation: BSONObjectID, _user: BSONObjectID)

object MTurkAnnotationReference{
  implicit val mturkAnnotationReferenceFormat = Json.format[MTurkAnnotationReference]
}
