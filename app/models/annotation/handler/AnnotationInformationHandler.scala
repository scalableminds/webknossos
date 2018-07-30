package models.annotation.handler

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.AnnotationTypeSQL.AnnotationTypeSQL
import models.annotation._
import models.user.User
import play.api.libs.concurrent.Execution.Implicits._
import utils.ObjectId

object AnnotationInformationHandler {
  val informationHandlers: Map[AnnotationTypeSQL, AnnotationInformationHandler] = Map(
    AnnotationTypeSQL.CompoundProject -> ProjectInformationHandler,
    AnnotationTypeSQL.CompoundTask     -> TaskInformationHandler,
    AnnotationTypeSQL.CompoundTaskType -> TaskTypeInformationHandler)
      .withDefaultValue(SavedTracingInformationHandler)
}

trait AnnotationInformationHandler extends FoxImplicits {

  def cache: Boolean = true

  def provideAnnotation(identifier: ObjectId, user: Option[User])(implicit ctx: DBAccessContext): Fox[Annotation]

  def nameForAnnotation(t: Annotation)(implicit ctx: DBAccessContext): Fox[String] = {
    Fox.successful(t.id)
  }

  def restrictionsFor(identifier: ObjectId)(implicit ctx: DBAccessContext): Fox[AnnotationRestrictions]

  def assertAllOnSameDataset(annotations: List[Annotation]): Fox[Boolean] = {
    def allOnSameDatasetIter(annotations: List[Annotation], _dataSet: ObjectId): Boolean =
      annotations match {
        case List() => true
        case head :: tail => head._dataSet == _dataSet && allOnSameDatasetIter(tail, _dataSet)
      }
    annotations match {
      case List() => Fox.successful(true)
      case head :: tail => {
        if (allOnSameDatasetIter(annotations, annotations.head._dataSet))
          Fox.successful(true)
        else
          Fox.failure("Cannot create compound annotation spanning multiple datasets")
      }
    }
  }

  def assertNonEmpty[T](seq: List[T]): Fox[Unit] = {
    if (seq.isEmpty) Fox.failure("no annotations")
    else Fox.successful(())
  }
}
