package controllers

import play.api.libs.json._
<<<<<<< HEAD
import oxalis.nml.BranchPoint
import play.api.mvc._
import org.bson.types.ObjectId
import braingames.util.Math._
import oxalis.security.{UserAwareRequest, Secured, AuthenticatedRequest}
import braingames.geometry.Vector3I
import braingames.geometry.Vector3I._
import models.user.User
=======
import oxalis.security.Secured
>>>>>>> ca2aaa77333ce8e01a21890b459efb2a30764ed6
import models.security._
import net.liftweb.common._
<<<<<<< HEAD
import braingames.mvc.{BoxImplicits, Fox, Controller}
import controllers.admin.NMLIO
import play.api.templates.Html
import models.task.Project
import models.task.TaskType
import oxalis.annotation.handler._
=======
import braingames.mvc.Controller
import oxalis.security.AuthenticatedRequest
>>>>>>> ca2aaa77333ce8e01a21890b459efb2a30764ed6
import scala.concurrent.Future
import scala.concurrent.duration._
import oxalis.annotation.{RequestAnnotation, AnnotationIdentifier}
import akka.pattern.ask
import play.api.libs.concurrent.Execution.Implicits._
import akka.util.Timeout
import models.annotation.AnnotationLike
import models.annotation.AnnotationType._
import oxalis.annotation.handler.AnnotationInformationHandler
<<<<<<< HEAD
import models.basics.Implicits._
=======
import braingames.util.{FoxImplicits, Fox}
>>>>>>> ca2aaa77333ce8e01a21890b459efb2a30764ed6

object TracingController extends Controller with Secured with TracingInformationProvider {
  override val DefaultAccessRole = Role.User
}

trait TracingInformationProvider extends play.api.http.Status with FoxImplicits with models.basics.Implicits {

  import AnnotationInformationHandler._

  def withInformationHandler[A, T](tracingType: String)(f: AnnotationInformationHandler => T)(implicit request: UserAwareRequest[_]): T = {
    f(informationHandlers(tracingType))
  }

  def withAnnotation[T](typ: AnnotationType, id: String)(f: AnnotationLike => Box[T])(implicit request: UserAwareRequest[_]): Fox[T] = {
    withAnnotation(AnnotationIdentifier(typ, id))(a => Future.successful(f(a)))
  }

  def withAnnotation[T](annotationId: AnnotationIdentifier)(f: AnnotationLike => Fox[T])(implicit request: UserAwareRequest[_]): Fox[T] = {
    findAnnotation(annotationId).flatMap(f)
  }

  def findAnnotation(typ: AnnotationType, id: String)(implicit request: UserAwareRequest[_]): Fox[AnnotationLike] = {
    findAnnotation(AnnotationIdentifier(typ, id))
  }

  def findAnnotation(annotationId: AnnotationIdentifier)(implicit request: UserAwareRequest[_]): Fox[AnnotationLike] = {
    implicit val timeout = Timeout(5 seconds)
    val f = Application.annotationStore ? RequestAnnotation(annotationId, authedRequestToDBAccess)

<<<<<<< HEAD
    //TODO: RF - fix .when(_.state.isFinished)(_.allowAllModes)
    f.mapTo[AnnotationLike].map{
      Full(_)
    }.recover{
      case e =>
        Logger.error("Got an error: " + e)
        Failure(e.toString)
    }
=======
    f.mapTo[Box[AnnotationLike]]
>>>>>>> ca2aaa77333ce8e01a21890b459efb2a30764ed6
  }

  def nameAnnotation(annotation: AnnotationLike)(implicit request: AuthenticatedRequest[_]) = Box.legacyNullTest[String] {
    withInformationHandler(annotation.typ) {
      handler =>
        handler.nameForAnnotation(annotation)
    }
  }

  def respondWithTracingInformation(annotationId: AnnotationIdentifier)(implicit request: UserAwareRequest[_]): Fox[JsValue] = {
    withAnnotation(annotationId) {
      annotation =>
        annotation.annotationInfo(request.userOpt).map(js => Full(js))
    }
  }
}
