package models.annotation

import oxalis.security.WebknossosSilhouette.UserAwareRequest
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.AnnotationTypeSQL.AnnotationTypeSQL
import models.annotation.handler.AnnotationInformationHandler
import play.api.libs.concurrent.Execution.Implicits._

trait AnnotationInformationProvider
  extends play.api.http.Status
    with FoxImplicits
    with models.basics.Implicits {

  def provideAnnotation(typ: String, id: String)(implicit request: UserAwareRequest[_]): Fox[AnnotationSQL] =
    for {
      annotationIdentifier <- AnnotationIdentifier.parse(typ, id)
      annotation <- provideAnnotation(annotationIdentifier) ?~> "annotation.notFound"
    } yield annotation

  def provideAnnotation(annotationIdentifier: AnnotationIdentifier)(implicit request: UserAwareRequest[_]): Fox[AnnotationSQL] = {
    AnnotationStore.requestAnnotation(annotationIdentifier, request.identity)
  }

  def nameFor(annotation: AnnotationSQL)(implicit request: UserAwareRequest[_]): Fox[String] = {
    if (annotation.name == "") {
      handlerForTyp(annotation.typ).nameForAnnotation(annotation)
    } else
      Fox.successful(annotation.name)
  }

  def restrictionsFor(typ: String, id: String)(implicit request: UserAwareRequest[_]): Fox[AnnotationRestrictions] =
    for {
      annotationIdentifier <- AnnotationIdentifier.parse(typ, id)
      restrictions <- restrictionsFor(annotationIdentifier)
    } yield restrictions

  def restrictionsFor(annotationId: AnnotationIdentifier)(implicit ctx: DBAccessContext): Fox[AnnotationRestrictions] = {
    handlerForTyp(annotationId.annotationType).restrictionsFor(annotationId.identifier)
  }

  private def handlerForTyp(typ: AnnotationTypeSQL) =
    AnnotationInformationHandler.informationHandlers(typ)

}
