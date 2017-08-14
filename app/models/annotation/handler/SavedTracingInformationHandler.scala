package models.annotation.handler

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.TextUtils._
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{Annotation, AnnotationDAO, AnnotationRestrictions}
import models.user.User
import play.api.libs.concurrent.Execution.Implicits._

import scala.concurrent.Future

object SavedTracingInformationHandler extends AnnotationInformationHandler with FoxImplicits {

  override val cache = false

  //TODO: RocksDB use this again?
  override def nameForAnnotation(a: Annotation)(implicit ctx: DBAccessContext): Future[String] = a match {
    case annotation: Annotation =>
      for {
        userName <- annotation.user.toFox.map(_.abreviatedName).getOrElse("")
        task <- annotation.task.map(_.id).getOrElse("explorational")
      } yield {
        val id = oxalis.view.helpers.formatHash(annotation.id)
        normalize(s"${annotation.dataSetName}__${task}__${userName}__${id}")
      }
    case a =>
      Future.successful(a.id)
  }

  def provideAnnotation(annotationId: String, user: Option[User])(implicit ctx: DBAccessContext): Fox[Annotation] = {
    for {
      annotation <- AnnotationDAO.findOneById(annotationId) ?~> "annotation.notFound"
    } yield {
      annotation
    }
  }

  def restrictionsFor(identifier: String)(implicit ctx: DBAccessContext) = {
    for {
      annotation <- provideAnnotation(identifier, None)
    } yield {
      AnnotationRestrictions.defaultAnnotationRestrictions(annotation)
    }
  }

}
