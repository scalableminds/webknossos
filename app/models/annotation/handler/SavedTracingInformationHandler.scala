package models.annotation.handler

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.TextUtils._
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation._
import models.user.User
import play.api.libs.concurrent.Execution.Implicits._
import utils.ObjectId

object SavedTracingInformationHandler extends AnnotationInformationHandler with FoxImplicits {

  override val cache = false

  override def nameForAnnotation(annotation: AnnotationSQL)(implicit ctx: DBAccessContext): Fox[String] =
    for {
      userName <- annotation.user.map(_.abreviatedName).getOrElse("")
      dataSetName <- annotation.dataSet.map(_.name)
      task = annotation._task.map(_.toString).getOrElse("explorational")
    } yield {
      val id = oxalis.view.helpers.formatHash(annotation.id)
      normalize(s"${dataSetName}__${task}__${userName}__${id}")
    }

  def provideAnnotation(annotationId: ObjectId, userOpt: Option[User])(implicit ctx: DBAccessContext): Fox[AnnotationSQL] =
    AnnotationSQLDAO.findOne(annotationId) ?~> "annotation.notFound"

  def restrictionsFor(identifier: ObjectId)(implicit ctx: DBAccessContext) = {
    for {
      annotation <- provideAnnotation(identifier, None)
    } yield {
      AnnotationRestrictions.defaultAnnotationRestrictions(annotation)
    }
  }

}
