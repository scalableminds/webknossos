package controllers

import javax.inject.Inject

import models.user.User
import play.api.libs.concurrent.Akka
import play.api.libs.json._
import oxalis.security.{AuthenticatedRequest, Secured, UserAwareRequest}
import net.liftweb.common._
import scala.concurrent.Future
import scala.concurrent.duration._

import akka.pattern.ask
import play.api.libs.concurrent.Execution.Implicits._
import akka.util.Timeout
import com.scalableminds.util.tools.ExtendedTypes.ExtendedBoolean
import play.api.i18n.{I18nSupport, Messages, MessagesApi}
import models.annotation.{Annotation, AnnotationIdentifier, AnnotationLike, AnnotationStore}
import models.annotation.AnnotationType._
import models.annotation.handler.AnnotationInformationHandler
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import play.api.Logger

class TracingController @Inject() (val messagesApi: MessagesApi) extends Controller with Secured with TracingInformationProvider

trait TracingInformationProvider extends play.api.http.Status with FoxImplicits with models.basics.Implicits with I18nSupport{

  import AnnotationInformationHandler._

  def withInformationHandler[A, T](tracingType: String)(f: AnnotationInformationHandler => T)(implicit request: UserAwareRequest[_]): T = {
    f(informationHandlers(tracingType))
  }

  def withAnnotation[T](typ: AnnotationType, id: String)(f: AnnotationLike => Fox[T])(implicit request: UserAwareRequest[_]): Fox[T] = {
    withAnnotation(AnnotationIdentifier(typ, id))(a => f(a))
  }

  def withAnnotation[T](annotationId: AnnotationIdentifier)(f: AnnotationLike => Fox[T])(implicit request: UserAwareRequest[_]): Fox[T] = {
    findAnnotation(annotationId).flatMap(f)
  }

  def findAnnotation(typ: AnnotationType, id: String)(implicit request: UserAwareRequest[_]): Fox[AnnotationLike] = {
    findAnnotation(AnnotationIdentifier(typ, id))
  }

  def findAnnotation(annotationId: AnnotationIdentifier)(implicit request: UserAwareRequest[_]): Fox[AnnotationLike] = {
    AnnotationStore.requestAnnotation(annotationId, request.userOpt)
  }

  def withMergedAnnotation[T](typ: AnnotationType, id: String, mergedId: String, mergedTyp: String, readOnly: Boolean)(f: AnnotationLike => Fox[T])(implicit request: AuthenticatedRequest[_]): Fox[T] = {
    mergeAnnotation(AnnotationIdentifier(typ, id), AnnotationIdentifier(mergedTyp, mergedId), readOnly).flatMap(f)
  }

  def mergeAnnotation(annotationId: AnnotationIdentifier, mergedAnnotationId: AnnotationIdentifier, readOnly: Boolean)(implicit request: AuthenticatedRequest[_]): Fox[AnnotationLike] = {
    val annotation = AnnotationStore.requestAnnotation(annotationId, request.userOpt)
    val annotationSec = AnnotationStore.requestAnnotation(mergedAnnotationId, request.userOpt)

    AnnotationStore.mergeAnnotation(annotation, annotationSec, readOnly, request.user)
  }

  def nameAnnotation(annotation: AnnotationLike)(implicit request: AuthenticatedRequest[_]): Fox[String] = {
    withInformationHandler(annotation.typ) {
      handler =>
        annotation._name.toFox.orElse(handler.nameForAnnotation(annotation).toFox)
    }
  }

  def tracingInformation(annotation: AnnotationLike, readOnly: Boolean)(implicit request: UserAwareRequest[_]): Fox[JsValue] = {
    for {
      _ <- annotation.restrictions.allowAccess(request.userOpt) ?~> Messages("notAllowed") ~> BAD_REQUEST
      json <- if(readOnly)
                annotation.makeReadOnly.annotationInfo(request.userOpt)
              else
                annotation.annotationInfo(request.userOpt)
    } yield json
  }
}
