package models.annotation.handler

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.Fox
import models.annotation.{Annotation, AnnotationRestrictions, AnnotationType}
import models.user.User
import play.api.libs.concurrent.Execution.Implicits._

import scala.concurrent.Future

object AnnotationInformationHandler {
  val informationHandlers: Map[String, AnnotationInformationHandler] = Map(
    AnnotationType.CompoundProject.toString  -> ProjectInformationHandler,
    AnnotationType.CompoundTask.toString     -> TaskInformationHandler,
    AnnotationType.CompoundTaskType.toString -> TaskTypeInformationHandler)
      .withDefaultValue(SavedTracingInformationHandler)
}

trait AnnotationInformationHandler {

  def cache: Boolean = true

  def provideAnnotation(identifier: String, user: Option[User])(implicit ctx: DBAccessContext): Fox[Annotation]

  def nameForAnnotation(t: Annotation)(implicit ctx: DBAccessContext): Future[String] = {
    Future.successful(t.id)
  }

  def restrictionsFor(identifier: String)(implicit ctx: DBAccessContext): Fox[AnnotationRestrictions]

  def assertAllOnSameDataset(annotations: List[Annotation]): Fox[Boolean] = {
    def allOnSameDatasetIter(annotations: List[Annotation], dataSetName: String): Boolean =
      annotations match {
        case List() => true
        case head :: tail => head.dataSetName == dataSetName && allOnSameDatasetIter(tail, dataSetName)
      }
    annotations match {
      case List() => Fox.successful(true)
      case head :: tail => {
        if (allOnSameDatasetIter(annotations, annotations.head.dataSetName))
          Fox.successful(true)
        else
          Fox.failure("Cannot create compound annotation spanning multiple datasets")
      }
    }
  }

  def assertNonEmpty(annotations: List[Annotation]): Fox[Boolean] = {
    annotations match {
      case List() => Fox.failure("no annotations")
      case _ => Fox.successful(true)
    }
  }
}
