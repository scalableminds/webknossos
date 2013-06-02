package oxalis.tracing.handler

import net.liftweb.common.Box
import play.api.i18n.Messages
import braingames.util.TextUtils._
import models.annotation.{AnnotationDAO, AnnotationLike, Annotation}

object SavedTracingInformationHandler extends AnnotationInformationHandler {

  import braingames.mvc.BoxImplicits._

  type AType = Annotation

  override val cache = false

  override def nameForAnnotation(a: AnnotationLike): String = a match {
    case annotation: Annotation =>
      val task = annotation.task.map(_.id) getOrElse ("explorational")
      val user = annotation.user.map(_.abreviatedName) getOrElse ""
      val id = oxalis.view.helpers.formatHash(annotation.id)
      normalize(s"${annotation.dataSetName}__${task}__${user}__${id}")
    case a =>
      a.id
  }

  def provideAnnotation(annotationId: String): Box[Annotation] = {
    for {
      annotation <- AnnotationDAO.findOneById(annotationId) ?~ Messages("annotation.notFound")
    } yield {
      annotation
    }
  }

}