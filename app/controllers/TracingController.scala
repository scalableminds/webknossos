package controllers

import play.api.libs.json._
import oxalis.security.{UserAwareRequest, Secured, AuthenticatedRequest}
import net.liftweb.common._
import scala.concurrent.Future
import scala.concurrent.duration._
import oxalis.annotation.{MergeAnnotation, RequestAnnotation, AnnotationIdentifier}
import akka.pattern.ask
import play.api.libs.concurrent.Execution.Implicits._
import akka.util.Timeout
import models.annotation.{Annotation, AnnotationLike}
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

  def withMergedAnnotation[T](typ: AnnotationType, id: String, mergedId: String, mergedTyp: String, readOnly: Boolean)(f: AnnotationLike => Fox[T])(implicit request: UserAwareRequest[_]): Fox[T] = {
    mergeAnnotation(AnnotationIdentifier(typ, id), AnnotationIdentifier(mergedTyp, mergedId), readOnly).flatMap(f)
  }

  def mergeAnnotation(annotationId: AnnotationIdentifier, mergedAnnotationId: AnnotationIdentifier, readOnly: Boolean)(implicit request: UserAwareRequest[_]): Fox[AnnotationLike] = {
    implicit val timeout = Timeout(5 seconds)

    val annotation = Application.annotationStore ? RequestAnnotation(annotationId, request.userOpt, authedRequestToDBAccess)
    val annotationSec = Application.annotationStore ? RequestAnnotation(mergedAnnotationId, request.userOpt, authedRequestToDBAccess)

    val f = Application.annotationStore ? MergeAnnotation(annotation.mapTo[Box[AnnotationLike]], annotationSec.mapTo[Box[AnnotationLike]], readOnly, request.userOpt, authedRequestToDBAccess)

    f.mapTo[Box[AnnotationLike]]
  }

  def nameAnnotation(annotation: AnnotationLike)(implicit request: AuthenticatedRequest[_]) = {
    withInformationHandler(annotation.typ) {
      handler =>
        handler.nameForAnnotation(annotation)
    }
  }

  def respondWithTracingInformation(annotationId: AnnotationIdentifier)(implicit request: UserAwareRequest[_]): Fox[JsValue] = {
    withAnnotation(annotationId) {
      annotation =>
        annotation.annotationInfo(request.userOpt)
    }
  }
}
