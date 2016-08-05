package oxalis.annotation.handler

import scala.concurrent.Future

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{AnnotationRestrictions, AnnotationType, TemporaryAnnotation}
import models.binary.DataSetDAO
import models.tracing.skeleton.SkeletonTracing
import models.tracing.skeleton.temporary.TemporarySkeletonTracing
import models.user.User
import play.api.libs.concurrent.Execution.Implicits._

/**
  * Company: scalableminds
  * User: tmbo
  * Date: 03.08.13
  * Time: 18:39
  */
object DataSetInformationHandler extends AnnotationInformationHandler with FoxImplicits {

  type AType = TemporaryAnnotation

  def dataSetRestrictions() =
    new AnnotationRestrictions {
      override def allowAccess(user: Option[User]) = true

      override def allowDownload(user: Option[User]) = false
    }

  def provideAnnotation(dataSetName: String, user: Option[User])(implicit ctx: DBAccessContext): Fox[TemporaryAnnotation] = {
    for {
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> "dataSet.notFound"
      team = user.flatMap(_.teamNames.intersect(dataSet.allowedTeams).headOption).getOrElse("")
    } yield {
      val content = TemporarySkeletonTracing(
        dataSetName,
        dataSetName,
        Nil,
        System.currentTimeMillis(),
        Some(0),
        dataSet.defaultStart,
        dataSet.defaultRotation,
        SkeletonTracing.defaultZoomLevel,
        None,
        None,
        None,
        None
      )

      TemporaryAnnotation(
        dataSetName,
        user.map(_._id),
        () => Future.successful(Some(content)),
        None,
        team,
        None,
        typ = AnnotationType.View,
        restrictions = dataSetRestrictions())
    }
  }
}
