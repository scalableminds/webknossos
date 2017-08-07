package controllers

import javax.inject.Inject

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.AnnotationType._
import models.annotation.handler.AnnotationInformationHandler
import models.annotation.{Annotation, AnnotationIdentifier, AnnotationStore}
import oxalis.security.{AuthenticatedRequest, Secured, UserAwareRequest}
import play.api.i18n.{I18nSupport, Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._

class TracingController @Inject() (val messagesApi: MessagesApi)
  extends Controller
    with Secured
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

  def nameAnnotation(annotation: Annotation)(implicit request: AuthenticatedRequest[_]): Fox[String] = {
    withInformationHandler(annotation.typ) {
      handler =>
        annotation._name.toFox.orElse(handler.nameForAnnotation(annotation).toFox)
    }
  }

  def tracingInformation(
    annotation: Annotation,
    readOnly: Boolean)(implicit request: UserAwareRequest[_]): Fox[JsValue] = {
    for {
      _ <- annotation.restrictions.allowAccess(request.userOpt) ?~> Messages("notAllowed") ~> BAD_REQUEST
      json <- if(readOnly)
                annotation.makeReadOnly.annotationInfo(request.userOpt)
              else
                annotation.annotationInfo(request.userOpt)
    } yield json
  }
}
