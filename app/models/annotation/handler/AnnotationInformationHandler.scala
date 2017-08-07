package models.annotation.handler

import net.liftweb.common.Box
import oxalis.security.AuthenticatedRequest
import models.annotation.{AnnotationType, Annotation}
import com.scalableminds.util.reactivemongo.DBAccessContext
import models.basics.Implicits._
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.tools.Fox
import models.user.User

object AnnotationInformationHandler {
  val informationHandlers: Map[String, AnnotationInformationHandler] = Map(
    AnnotationType.View.toString ->
      DataSetInformationHandler,
    AnnotationType.CompoundProject.toString ->
      ProjectInformationHandler,
    AnnotationType.CompoundTask.toString ->
      TaskInformationHandler,
    AnnotationType.CompoundTaskType.toString ->
      TaskTypeInformationHandler).withDefaultValue(SavedTracingInformationHandler)
}

trait AnnotationInformationHandler {

  def cache: Boolean = true

  def provideAnnotation(identifier: String, user: Option[User])(implicit ctx: DBAccessContext): Fox[Annotation]

  /*def nameForAnnotation(identifier: String)(implicit request: AuthenticatedRequest[_]): Box[String] = {
    withAnnotation(identifier)(nameForAnnotation)
  } */

  def nameForAnnotation(t: Annotation)(implicit ctx: DBAccessContext): Future[String] = {
    Future.successful(t.id)
  }

  def withAnnotation[A](identifier: String)(f: Annotation => A)(implicit request: AuthenticatedRequest[_]): Fox[A] = {
    provideAnnotation(identifier, Some(request.user)).map(f)
  }

}
