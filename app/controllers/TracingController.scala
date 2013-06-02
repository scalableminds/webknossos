package controllers

import play.api.Logger
import play.api.libs.json.Json._
import play.api.libs.json._
import oxalis.nml.BranchPoint
import play.api.mvc._
import org.bson.types.ObjectId
import braingames.util.Math._
import oxalis.security.Secured
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
import braingames.mvc.Controller
import controllers.admin.NMLIO
import oxalis.security.AuthenticatedRequest
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
import models.tracing.skeleton.{TracingLike, Tracing, TemporaryTracing, CompoundAnnotation}
import oxalis.annotation.handler.AnnotationInformationHandler

object TracingController extends Controller with Secured with TracingInformationProvider {
  override val DefaultAccessRole = Role.User
}

trait TracingInformationProvider extends play.api.http.Status {

  import braingames.mvc.BoxImplicits._

  import AnnotationInformationHandler._

  def withInformationHandler[A, T](tracingType: String)(f: AnnotationInformationHandler => T)(implicit request: AuthenticatedRequest[_]): T = {
    f(informationHandlers(tracingType))
  }

  def findAnnotation(typ: AnnotationType, id: String)(implicit request: AuthenticatedRequest[_]): Future[Box[AnnotationLike]] = {
    val annotationId = AnnotationIdentifier(typ, id)
    findAnnotation(annotationId)
  }

  def withAnnotation[T](typ: AnnotationType, id: String)(f: AnnotationLike => Box[T])(implicit request: AuthenticatedRequest[_]): Future[Box[T]] = {
    findAnnotation(typ, id).map(_.flatMap(f))
  }

  def findAnnotation(annotationId: AnnotationIdentifier)(implicit request: AuthenticatedRequest[_]): Future[Box[AnnotationLike]] = {
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

  def respondWithTracingInformation(annotationId: AnnotationIdentifier)(implicit request: AuthenticatedRequest[_]): Future[Box[JsObject]] = {
    findAnnotation(annotationId).map(_.flatMap {
      annotation =>
        annotation.content.map(_.createTracingInformation())
    })
  }
}