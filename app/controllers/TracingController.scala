package controllers

import javax.inject.Inject

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.AnnotationType._
import models.annotation.handler.AnnotationInformationHandler
import models.annotation.{AnnotationIdentifier, AnnotationLike, AnnotationStore}
import oxalis.security.silhouetteOxalis.{UserAwareAction, UserAwareRequest, SecuredRequest, SecuredAction}
import play.api.i18n.{I18nSupport, Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._

class TracingController @Inject() (val messagesApi: MessagesApi)
  extends Controller
    with TracingInformationProvider

trait TracingInformationProvider
  extends play.api.http.Status
    with FoxImplicits
    with models.basics.Implicits with I18nSupport {

  import AnnotationInformationHandler._

  def withInformationHandler[A, T](
    tracingType: String)(f: AnnotationInformationHandler => T)(implicit request: UserAwareRequest[_]): T = {

    f(informationHandlers(tracingType))
  }

  def withAnnotation[T](
    typ: AnnotationType,
    id: String)(f: AnnotationLike => Fox[T])(implicit request: UserAwareRequest[_]): Fox[T] = {

    withAnnotation(AnnotationIdentifier(typ, id))(a => f(a))
  }

  def withAnnotation[T](
    annotationId: AnnotationIdentifier)(f: AnnotationLike => Fox[T])(implicit request: UserAwareRequest[_]): Fox[T] = {

    findAnnotation(annotationId).flatMap(f)
  }

  def findAnnotation(
    typ: AnnotationType,
    id: String)(implicit request: UserAwareRequest[_]): Fox[AnnotationLike] = {

    findAnnotation(AnnotationIdentifier(typ, id))
  }

  def findAnnotation(annotationId: AnnotationIdentifier)(implicit request: UserAwareRequest[_]): Fox[AnnotationLike] = {
    AnnotationStore.requestAnnotation(annotationId, request.identity)
  }

  def withMergedAnnotation[T](
    typ: AnnotationType,
    id: String,
    mergedId: String,
    mergedTyp: String,
    readOnly: Boolean)(f: AnnotationLike => Fox[T])(implicit request: SecuredRequest[_]): Fox[T] = {

    mergeAnnotation(AnnotationIdentifier(typ, id), AnnotationIdentifier(mergedTyp, mergedId), readOnly).flatMap(f)
  }

  def mergeAnnotation(
    annotationId: AnnotationIdentifier,
    mergedAnnotationId: AnnotationIdentifier,
    readOnly: Boolean)(implicit request: SecuredRequest[_]): Fox[AnnotationLike] = {

    val annotation = AnnotationStore.requestAnnotation(annotationId, Some(request.identity))
    val annotationSec = AnnotationStore.requestAnnotation(mergedAnnotationId, Some(request.identity))

    AnnotationStore.mergeAnnotation(annotation, annotationSec, readOnly, request.identity)
  }

  def nameAnnotation(annotation: AnnotationLike)(implicit request: UserAwareRequest[_]): Fox[String] = {
    withInformationHandler(annotation.typ) {
      handler =>
        annotation._name.toFox.orElse(handler.nameForAnnotation(annotation).toFox)
    }
  }

  def tracingInformation(
    annotation: AnnotationLike,
    readOnly: Boolean)(implicit request: UserAwareRequest[_]): Fox[JsValue] = {
    for {
      _ <- annotation.restrictions.allowAccess(request.identity) ?~> Messages("notAllowed") ~> BAD_REQUEST
      json <- if(readOnly)
                annotation.makeReadOnly.annotationInfo(request.identity)
              else
                annotation.annotationInfo(request.identity)
    } yield json
  }
}
