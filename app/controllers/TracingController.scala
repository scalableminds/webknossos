package controllers

import play.api.Logger
import play.api.libs.json.Json._
import play.api.libs.json._
import oxalis.nml.BranchPoint
import play.api.mvc._
import org.bson.types.ObjectId
import braingames.util.Math._
import oxalis.security.{UserAwareRequest, Secured, AuthenticatedRequest}
import braingames.geometry.Vector3I
import braingames.geometry.Vector3I._
import models.user.User
import models.security._
import play.api.libs.iteratee._
import play.api.libs.iteratee.Concurrent.Channel
import play.api.libs.Comet
import oxalis.nml.Node
import oxalis.nml.Edge
import braingames.geometry.Point3D
import models.user.TimeTracking
import oxalis.view.helpers._
import models.task.Task
import views._
import play.api.i18n.Messages
import net.liftweb.common._
import braingames.mvc.{BoxImplicits, Fox, Controller}
import controllers.admin.NMLIO
import play.api.templates.Html
import models.task.Project
import models.task.TaskType
import oxalis.annotation.handler._
import scala.concurrent.Future
import scala.concurrent.duration._
import oxalis.annotation.{RequestAnnotation, AnnotationIdentifier}
import akka.pattern.ask
import play.api.libs.concurrent.Execution.Implicits._
import akka.util.Timeout
import braingames.util.ExtendedTypes.When
import models.binary.DataSetDAO
import models.annotation.{AnnotationLike, AnnotationDAO}
import models.annotation.AnnotationType._
import models.tracing.skeleton.{SkeletonTracingLike, SkeletonTracing, TemporarySkeletonTracing, CompoundAnnotation}
import oxalis.annotation.handler.AnnotationInformationHandler
import models.basics.Implicits._

object TracingController extends Controller with Secured with TracingInformationProvider {
  override val DefaultAccessRole = Role.User
}

trait TracingInformationProvider extends play.api.http.Status with BoxImplicits with models.basics.Implicits {

  import braingames.mvc.BoxImplicits._

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

    //TODO: RF - fix .when(_.state.isFinished)(_.allowAllModes)
    f.mapTo[AnnotationLike].map{
      Full(_)
    }.recover{
      case e =>
        Logger.error("Got an error: " + e)
        Failure(e.toString)
    }
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
