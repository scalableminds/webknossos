package oxalis.annotation.handler

import models.annotation.{AnnotationType, AnnotationRestrictions, TemporaryAnnotation}
import models.task.Project
import models.user.User
import net.liftweb.common.Box
import play.api.i18n.Messages
import models.tracing.skeleton.{TemporarySkeletonTracing, CompoundAnnotation}
import models.binary.DataSetDAO
import braingames.reactivemongo.DBAccessContext
import play.api.libs.concurrent.Execution.Implicits._
import braingames.geometry.Point3D
import play.api.Logger
import braingames.util.{FoxImplicits, Fox}
import scala.concurrent.Future
import models.team.Role
import models.tracing.skeleton.SkeletonTracing

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

  def provideAnnotation(dataSetName: String, user: Option[User])(implicit ctx: DBAccessContext): Fox[TemporaryAnnotation] = {
    for {
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
    } yield {
      val content = TemporarySkeletonTracing(
        dataSetName,
        dataSetName,
        Nil,
        Nil,
        System.currentTimeMillis(),
        Some(0),
        dataSet.defaultStart,
        SkeletonTracing.defaultZoomLevel,
        None
      )

      val team = user.flatMap(_.teams.map(_.team).intersect(dataSet.allowedTeams).headOption) getOrElse ""    //TODO: refactor

      TemporaryAnnotation(
        dataSetName,
        team,
        () => Future.successful(Some(content)),
        AnnotationType.View,
        dataSetRestrictions())
    }
  }
}
