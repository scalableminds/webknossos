package models.annotation

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import javax.inject.Inject
import models.annotation.AnnotationType.AnnotationType
import models.annotation.handler.AnnotationInformationHandlerSelector
import models.user.User

import scala.concurrent.ExecutionContext

class AnnotationInformationProvider @Inject()(
    annotationInformationHandlerSelector: AnnotationInformationHandlerSelector,
    annotationStore: AnnotationStore)(implicit ec: ExecutionContext)
    extends play.api.http.Status
    with FoxImplicits {

  def provideAnnotation(typ: String, id: String, user: User)(implicit ctx: DBAccessContext): Fox[Annotation] =
    provideAnnotation(typ, id, Some(user))

  def provideAnnotation(typ: String, id: String, userOpt: Option[User])(
      implicit ctx: DBAccessContext): Fox[Annotation] =
    for {
      annotationIdentifier <- AnnotationIdentifier.parse(typ, id)
      annotation <- provideAnnotation(annotationIdentifier, userOpt) ?~> "annotation.notFound"
    } yield annotation

  def provideAnnotation(annotationIdentifier: AnnotationIdentifier, userOpt: Option[User])(
      implicit ctx: DBAccessContext): Fox[Annotation] =
    annotationStore.requestAnnotation(annotationIdentifier, userOpt)

  def nameFor(annotation: Annotation)(implicit ctx: DBAccessContext): Fox[String] =
    if (annotation.name == "") {
      handlerForTyp(annotation.typ).nameForAnnotation(annotation)
    } else
      Fox.successful(annotation.name)

  def restrictionsFor(typ: String, id: String)(implicit ctx: DBAccessContext): Fox[AnnotationRestrictions] =
    for {
      annotationIdentifier <- AnnotationIdentifier.parse(typ, id)
      restrictions <- restrictionsFor(annotationIdentifier)
    } yield restrictions

  def restrictionsFor(annotationId: AnnotationIdentifier)(implicit ctx: DBAccessContext): Fox[AnnotationRestrictions] =
    handlerForTyp(annotationId.annotationType).restrictionsFor(annotationId.identifier)

  private def handlerForTyp(typ: AnnotationType) =
    annotationInformationHandlerSelector.informationHandlers(typ)

}
