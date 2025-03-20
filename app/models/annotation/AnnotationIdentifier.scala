package models.annotation

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.AnnotationType.AnnotationType
import com.scalableminds.util.objectid.ObjectId

import scala.concurrent.ExecutionContext

case class AnnotationIdentifier(annotationType: AnnotationType, identifier: ObjectId) {

  def toUniqueString: String =
    f"${annotationType}__$identifier"

}

object AnnotationIdentifier extends FoxImplicits {

  def parse(typ: String, id: ObjectId)(implicit ec: ExecutionContext): Fox[AnnotationIdentifier] =
    for {
      typ <- AnnotationType.fromString(typ) ?~> ("Invalid AnnotationType: " + typ)
    } yield AnnotationIdentifier(typ, id)
}
