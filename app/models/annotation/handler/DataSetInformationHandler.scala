package models.annotation.handler

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{Annotation, AnnotationRestrictions, AnnotationType}
import models.binary.DataSetDAO
import models.user.User
import scala.concurrent.ExecutionContext.Implicits.global

import scala.concurrent.Future

/**
  * Company: scalableminds
  * User: tmbo
  * Date: 03.08.13
  * Time: 18:39
  */
object DataSetInformationHandler extends AnnotationInformationHandler with FoxImplicits {

  def dataSetRestrictions() =
    new AnnotationRestrictions {
      override def allowAccess(user: Option[User]) = true

      override def allowDownload(user: Option[User]) = false
    }

  def provideAnnotation(dataSetName: String, user: Option[User])(implicit ctx: DBAccessContext): Fox[Annotation] = Fox.empty //TODO: rocksDB
  /*{
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
  }*/
}
