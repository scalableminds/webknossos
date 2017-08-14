package models.annotation

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.AnnotationType._
import models.annotation.handler.AnnotationInformationHandler
import oxalis.security.{AuthenticatedRequest, UserAwareRequest}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._

trait AnnotationInformationProvider
  extends play.api.http.Status
    with FoxImplicits
    with models.basics.Implicits {

  def withAnnotation[T](
    typ: AnnotationType,
    id: String)(f: Annotation => Fox[T])(implicit request: UserAwareRequest[_]): Fox[T] = {

    withAnnotation(AnnotationIdentifier(typ, id))(a => f(a))
  }

  def withAnnotation[T](
    annotationId: AnnotationIdentifier)(f: Annotation => Fox[T])(implicit request: UserAwareRequest[_]): Fox[T] = {

    findAnnotation(annotationId).flatMap(f)
  }

  def findAnnotation(
    typ: AnnotationType,
    id: String)(implicit request: UserAwareRequest[_]): Fox[Annotation] = {

    findAnnotation(AnnotationIdentifier(typ, id))
  }

  def findAnnotation(annotationId: AnnotationIdentifier)(implicit request: UserAwareRequest[_]): Fox[Annotation] = {
    AnnotationStore.requestAnnotation(annotationId, request.userOpt)
  }

  //TODO: RocksDB: use this for download filenames?
  def nameAnnotation(annotation: Annotation)(implicit request: AuthenticatedRequest[_]): Fox[String] = {
    val handler = AnnotationInformationHandler.informationHandlers(annotation.typ)
    annotation._name.toFox.orElse(handler.nameForAnnotation(annotation).toFox)
  }

  def restrictionsFor(annotationId: AnnotationIdentifier)(implicit ctx: DBAccessContext): Fox[AnnotationRestrictions] = {
    AnnotationInformationHandler.informationHandlers(annotationId.annotationType).restrictionsFor(annotationId.identifier)
  }

}
