package models.annotation

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.box.Full
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import models.annotation.AnnotationType.AnnotationType
import models.annotation.handler.AnnotationInformationHandlerSelector
import models.user.User
import com.scalableminds.util.objectid.ObjectId

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class AnnotationInformationProvider @Inject() (
    annotationDAO: AnnotationDAO,
    annotationInformationHandlerSelector: AnnotationInformationHandlerSelector,
    annotationStore: AnnotationStore
)(implicit ec: ExecutionContext)
    extends play.api.http.Status {

  def provideAnnotation(typ: String, id: ObjectId, user: User)(using ctx: DBAccessContext): Fox[Annotation] =
    provideAnnotation(typ, id, Some(user))

  def provideAnnotation(typ: String, id: ObjectId, userOpt: Option[User])(using ctx: DBAccessContext): Fox[Annotation] =
    for {
      annotationIdentifier <- AnnotationIdentifier.parse(typ, id)
      annotation <- provideAnnotation(annotationIdentifier, userOpt) ?~> Msg.Annotation.notFound
    } yield annotation

  def provideAnnotation(id: ObjectId, userOpt: Option[User])(using ctx: DBAccessContext): Fox[Annotation] =
    // this function only supports task/explorational look ups, not compound annotations
    for {
      _annotation <- annotationDAO.findOne(id) ?~> Msg.Annotation.notFound
      typ = if (_annotation._task.isEmpty) AnnotationType.Explorational else AnnotationType.Task
      annotationIdentifier = AnnotationIdentifier(typ, id)
      annotation <- provideAnnotation(annotationIdentifier, userOpt) ?~> Msg.Annotation.notFound
    } yield annotation

  def provideAnnotation(id: ObjectId, user: User)(using ctx: DBAccessContext): Fox[Annotation] =
    provideAnnotation(id, Some(user))

  def provideAnnotation(annotationIdentifier: AnnotationIdentifier, userOpt: Option[User])(using
      ctx: DBAccessContext
  ): Fox[Annotation] =
    annotationStore.requestAnnotation(annotationIdentifier, userOpt)

  def nameFor(annotation: Annotation)(using ctx: DBAccessContext): Fox[String] =
    if (annotation.name == "") {
      handlerForTyp(annotation.typ).nameForAnnotation(annotation)
    } else
      Fox.successful(annotation.name)

  def restrictionsFor(typ: String, id: ObjectId)(using ctx: DBAccessContext): Fox[AnnotationRestrictions] =
    for {
      annotationIdentifier <- AnnotationIdentifier.parse(typ, id)
      restrictions <- restrictionsFor(annotationIdentifier)
    } yield restrictions

  def restrictionsFor(annotationId: AnnotationIdentifier)(using ctx: DBAccessContext): Fox[AnnotationRestrictions] =
    handlerForTyp(annotationId.annotationType).restrictionsFor(annotationId.identifier)

  private def handlerForTyp(typ: AnnotationType) =
    annotationInformationHandlerSelector.informationHandlers(typ)

  def annotationForTracing(tracingId: String)(using ctx: DBAccessContext): Fox[Annotation] =
    for {
      storedAnnotationIdBox <- annotationDAO.findOneByTracingId(tracingId).shiftBox
      storedOrCachedAnnotationId <- storedAnnotationIdBox match {
        case Full(_) => storedAnnotationIdBox.toFox
        case _       => annotationStore.findCachedByTracingId(tracingId).toFox
      }
    } yield storedOrCachedAnnotationId

}
