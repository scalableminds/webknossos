package controllers

import play.api.libs.json._
import oxalis.security.Secured
import models.user.User
import models.security._
import net.liftweb.common._
import braingames.mvc.{BoxImplicits, Fox, Controller}
import controllers.admin.NMLIO
import oxalis.security.AuthenticatedRequest
import scala.concurrent.Future
import scala.concurrent.duration._
import oxalis.annotation.{RequestAnnotation, AnnotationIdentifier}
import akka.pattern.ask
import play.api.libs.concurrent.Execution.Implicits._
import akka.util.Timeout
import models.annotation.{AnnotationLike, AnnotationDAO}
import models.annotation.AnnotationType._
import oxalis.annotation.handler.AnnotationInformationHandler
import views._

object TracingController extends Controller with Secured with TracingInformationProvider {
  override val DefaultAccessRole = Role.User
}

trait TracingInformationProvider extends play.api.http.Status with BoxImplicits with models.basics.Implicits {

  import braingames.mvc.BoxImplicits._

  import AnnotationInformationHandler._

  def withInformationHandler[A, T](tracingType: String)(f: AnnotationInformationHandler => T)(implicit request: AuthenticatedRequest[_]): T = {
    f(informationHandlers(tracingType))
  }

  def withAnnotation[T](typ: AnnotationType, id: String)(f: AnnotationLike => Box[T])(implicit request: AuthenticatedRequest[_]): Fox[T] = {
    withAnnotation(AnnotationIdentifier(typ, id))(a => Future.successful(f(a)))
  }

  def withAnnotation[T](annotationId: AnnotationIdentifier)(f: AnnotationLike => Fox[T])(implicit request: AuthenticatedRequest[_]): Fox[T] = {
    findAnnotation(annotationId).flatMap(f)
  }

  def findAnnotation(typ: AnnotationType, id: String)(implicit request: AuthenticatedRequest[_]): Fox[AnnotationLike] = {
    findAnnotation(AnnotationIdentifier(typ, id))
  }

  def findAnnotation(annotationId: AnnotationIdentifier)(implicit request: AuthenticatedRequest[_]): Fox[AnnotationLike] = {
    implicit val timeout = Timeout(5 seconds)
    val f = Application.annotationStore ? RequestAnnotation(annotationId)

    //TODO: RF - fix .when(_.state.isFinished)(_.allowAllModes)
    f.mapTo[Box[AnnotationLike]]
  }

  def nameAnnotation(annotation: AnnotationLike)(implicit request: AuthenticatedRequest[_]) = Box.legacyNullTest[String] {
    withInformationHandler(annotation.typ) {
      handler =>
        handler.nameForAnnotation(annotation)
    }
  }

  def respondWithTracingInformation(annotationId: AnnotationIdentifier)(implicit request: AuthenticatedRequest[_]): Fox[JsValue] = {
    withAnnotation(annotationId) {
      annotation =>
        annotation.annotationInfo(request.user).map(js => Full(js))
    }
  }
}
