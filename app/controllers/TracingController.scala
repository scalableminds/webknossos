package controllers

import javax.inject.Inject

import models.user.User
import play.api.libs.concurrent.Akka
import play.api.libs.json._
import oxalis.security.{UserAwareRequest, Secured, AuthenticatedRequest}
import net.liftweb.common._
import scala.concurrent.Future
import scala.concurrent.duration._
import oxalis.annotation.{MergeAnnotation, RequestAnnotation, AnnotationIdentifier}
import akka.pattern.ask
import play.api.libs.concurrent.Execution.Implicits._
import akka.util.Timeout
import com.scalableminds.util.tools.ExtendedTypes.ExtendedBoolean
import play.api.i18n.{I18nSupport, MessagesApi, Messages}
import models.annotation.{Annotation, AnnotationLike}
import models.annotation.AnnotationType._
import oxalis.annotation.handler.AnnotationInformationHandler
import com.scalableminds.util.tools.{FoxImplicits, Fox}
import play.api.Logger

class TracingController @Inject() (val messagesApi: MessagesApi) extends Controller with Secured with TracingInformationProvider

trait TracingInformationProvider extends play.api.http.Status with FoxImplicits with models.basics.Implicits with I18nSupport{

  import AnnotationInformationHandler._

  lazy val annotationStore =
    Akka.system(play.api.Play.current).actorSelection("/user/annotationStore")

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
    val f = annotationStore ? RequestAnnotation(annotationId, request.userOpt, authedRequestToDBAccess)

    f.mapTo[Box[AnnotationLike]]
  }

  def withMergedAnnotation[T](typ: AnnotationType, id: String, mergedId: String, mergedTyp: String, readOnly: Boolean)(f: AnnotationLike => Fox[T])(implicit request: AuthenticatedRequest[_]): Fox[T] = {
    mergeAnnotation(AnnotationIdentifier(typ, id), AnnotationIdentifier(mergedTyp, mergedId), readOnly).flatMap(f)
  }

  def mergeAnnotation(annotationId: AnnotationIdentifier, mergedAnnotationId: AnnotationIdentifier, readOnly: Boolean)(implicit request: AuthenticatedRequest[_]): Fox[AnnotationLike] = {
    implicit val timeout = Timeout(5 seconds)

    val annotation = annotationStore ? RequestAnnotation(annotationId, request.userOpt, authedRequestToDBAccess)
    val annotationSec = annotationStore ? RequestAnnotation(mergedAnnotationId, request.userOpt, authedRequestToDBAccess)

    val f = annotationStore ? MergeAnnotation(annotation.mapTo[Box[AnnotationLike]], annotationSec.mapTo[Box[AnnotationLike]], readOnly, request.user, authedRequestToDBAccess)

    f.mapTo[Box[AnnotationLike]]
  }

  def nameAnnotation(annotation: AnnotationLike)(implicit request: AuthenticatedRequest[_]): Fox[String] = {
    withInformationHandler(annotation.typ) {
      handler =>
        annotation._name.toFox.orElse(handler.nameForAnnotation(annotation).toFox)
    }
  }

  def respondWithTracingInformation(annotationId: AnnotationIdentifier, readOnly: Boolean)(implicit request: UserAwareRequest[_]): Fox[JsValue] = {
    withAnnotation(annotationId) {
      annotation =>
        for {
          _ <- annotation.restrictions.allowAccess(request.userOpt) ?~> Messages("notAllowed") ~> 400
          json <- if(readOnly)
                    annotation.makeReadOnly.annotationInfo(request.userOpt)
                  else
                    annotation.annotationInfo(request.userOpt)
        } yield json
    }
  }
}
