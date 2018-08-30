package models.annotation

import oxalis.security.WebknossosSilhouette.UserAwareRequest
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import javax.inject.Inject
import models.annotation.AnnotationType.AnnotationType
import models.annotation.handler.AnnotationInformationHandlerSelector
import play.api.libs.concurrent.Execution.Implicits._

class AnnotationInformationProvider @Inject()(annotationInformationHandlerSelector: AnnotationInformationHandlerSelector)(annotationStore: AnnotationStore)
  extends play.api.http.Status
    with FoxImplicits
    with models.basics.Implicits {

  def provideAnnotation(typ: String, id: String)(implicit request: UserAwareRequest[_]): Fox[Annotation] =
    for {
      annotationIdentifier <- AnnotationIdentifier.parse(typ, id)
      annotation <- provideAnnotation(annotationIdentifier) ?~> "annotation.notFound"
    } yield annotation

  def provideAnnotation(annotationIdentifier: AnnotationIdentifier)(implicit request: UserAwareRequest[_]): Fox[Annotation] = {
    annotationStore.requestAnnotation(annotationIdentifier, request.identity)
  }

  def nameFor(annotation: Annotation)(implicit request: UserAwareRequest[_]): Fox[String] = {
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

  private def handlerForTyp(typ: AnnotationType) =
    annotationInformationHandlerSelector.informationHandlers(typ)

}
