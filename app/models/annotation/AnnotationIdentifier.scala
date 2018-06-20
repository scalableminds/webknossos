package models.annotation

import play.api.libs.json.Json

case class AnnotationIdentifier(annotationType: String, identifier: String) {

  def toUniqueString =
    annotationType + "__" + identifier
}

object AnnotationIdentifier {
  implicit val annotationIdentifierFormat = Json.format[AnnotationIdentifier]
}
