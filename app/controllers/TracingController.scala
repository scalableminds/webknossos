package controllers

import play.api.libs.json._
import oxalis.security.{UserAwareRequest, Secured, AuthenticatedRequest}
import net.liftweb.common._
import scala.concurrent.Future
import scala.concurrent.duration._
import oxalis.annotation.{RequestAnnotation, AnnotationIdentifier}
import akka.pattern.ask
import play.api.libs.concurrent.Execution.Implicits._
import akka.util.Timeout
import models.annotation.AnnotationLike
import models.annotation.AnnotationType._
import oxalis.annotation.handler.AnnotationInformationHandler
import com.scalableminds.util.tools.{FoxImplicits, Fox}
import play.api.Logger

object TracingController extends Controller with Secured with TracingInformationProvider

trait TracingInformationProvider extends play.api.http.Status with FoxImplicits with models.basics.Implicits {

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
    implicit val timeout = Timeout(5 seconds)
    val f = Application.annotationStore ? RequestAnnotation(annotationId, request.userOpt, authedRequestToDBAccess)

    f.mapTo[Box[AnnotationLike]]
  }

  def nameAnnotation(annotation: AnnotationLike)(implicit request: AuthenticatedRequest[_]): Fox[String] = {
    withInformationHandler(annotation.typ) {
      handler =>
        annotation._name.toFox.orElse(handler.nameForAnnotation(annotation).toFox)
    }
  }

  def respondWithTracingInformation(annotationId: AnnotationIdentifier)(implicit request: UserAwareRequest[_]): Fox[JsValue] = {
    withAnnotation(annotationId) {
      annotation =>
        annotation.annotationInfo(request.userOpt)
    }
  }
}
