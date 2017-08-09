package models.annotation.handler

import com.scalableminds.braingames.datastore.tracings.{TracingReference, TracingType}
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{Annotation, AnnotationRestrictions, AnnotationSettings, AnnotationType}
import models.binary.DataSetDAO
import models.user.User

/**
  * Company: scalableminds
  * User: tmbo
  * Date: 03.08.13
  * Time: 18:39
  */
object DataSetInformationHandler extends AnnotationInformationHandler with FoxImplicits {

  def provideAnnotation(dataSetName: String, user: Option[User])(implicit ctx: DBAccessContext): Fox[Annotation] = //TODO: rocksDB
  {
    for {
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> "dataSet.notFound"
      team = user.flatMap(_.teamNames.intersect(dataSet.allowedTeams).headOption).getOrElse("")
    } yield {
      Annotation(
        user.map(_._id),
        TracingReference("none", TracingType.skeleton), //TODO: rocksDB: construct empty tracing with dataSet.defaultStart etc.?
        dataSetName,
        team,
        AnnotationSettings.default,
        typ = AnnotationType.View
      )
    }
  }

  override def restrictionsFor(annotation: Annotation) =
    new AnnotationRestrictions {
      override def allowAccess(user: Option[User]) = true
      override def allowDownload(user: Option[User]) = false
    }
}
