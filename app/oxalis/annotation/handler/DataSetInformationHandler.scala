package oxalis.annotation.handler

import models.annotation.{AnnotationType, AnnotationRestrictions, TemporaryAnnotation}
import models.tracing.skeleton.temporary.TemporarySkeletonTracing
import models.user.User
import models.binary.DataSetDAO
import com.scalableminds.util.reactivemongo.DBAccessContext
import play.api.libs.concurrent.Execution.Implicits._
import play.api.Logger
import com.scalableminds.util.tools.{FoxImplicits, Fox}
import reactivemongo.bson.BSONObjectID
import scala.concurrent.Future
import models.tracing.skeleton.SkeletonTracing

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 03.08.13
 * Time: 18:39
 */
object DataSetInformationHandler extends AnnotationInformationHandler with FoxImplicits{

  import com.scalableminds.util.mvc.BoxImplicits._

  type AType = TemporaryAnnotation

  def dataSetRestrictions() =
    new AnnotationRestrictions {
      override def allowAccess(user: Option[User]) = true

      override def allowDownload(user: Option[User]) = false
    }

  def provideAnnotation(dataSetName: String, user: Option[User])(implicit ctx: DBAccessContext): Fox[TemporaryAnnotation] = {
    for {
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> "dataSet.notFound"
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
