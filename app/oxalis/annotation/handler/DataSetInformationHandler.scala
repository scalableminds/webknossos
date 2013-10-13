package oxalis.annotation.handler

import models.annotation.{AnnotationType, AnnotationRestrictions, TemporaryAnnotation}
import models.task.Project
import models.user.User
import models.security.Role
import net.liftweb.common.Box
import play.api.i18n.Messages
import models.tracing.skeleton.{TemporarySkeletonTracing, CompoundAnnotation}
import models.binary.DataSetDAO
import braingames.reactivemongo.DBAccessContext
import play.api.libs.concurrent.Execution.Implicits._
import braingames.geometry.Point3D
import play.api.Logger
import braingames.util.{FoxImplicits, Fox}

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 03.08.13
 * Time: 18:39
 */
object DataSetInformationHandler extends AnnotationInformationHandler with FoxImplicits{

  import braingames.mvc.BoxImplicits._

  type AType = TemporaryAnnotation

  def dataSetRestrictions() =
    new AnnotationRestrictions {
      override def allowAccess(user: Option[User]) = true
    }

  def provideAnnotation(dataSetName: String)(implicit ctx: DBAccessContext): Fox[TemporaryAnnotation] = {
    for {
      dataSet <- DataSetDAO.findOneByName(dataSetName) ?~> Messages("dataSet.notFound")
    } yield {
      val content = TemporarySkeletonTracing(
        dataSetName,
        dataSetName,
        Nil,
        Nil,
        System.currentTimeMillis(),
        Some(0),
        Point3D(5500, 3500, 2800) // make this dynamic!
      )
      TemporaryAnnotation(
        dataSetName,
        () => Some(content),
        AnnotationType.View,
        dataSetRestrictions())
    }
  }
}