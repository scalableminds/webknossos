package models.annotation.handler

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import javax.inject.Inject
import models.annotation.AnnotationType.AnnotationType
import models.annotation._
import models.user.User
import utils.ObjectId

import scala.annotation.tailrec
import scala.concurrent.ExecutionContext

class AnnotationInformationHandlerSelector @Inject()(projectInformationHandler: ProjectInformationHandler,
                                                     taskInformationHandler: TaskInformationHandler,
                                                     taskTypeInformationHandler: TaskTypeInformationHandler,
                                                     savedTracingInformationHandler: SavedTracingInformationHandler) {
  val informationHandlers: Map[AnnotationType, AnnotationInformationHandler] = Map(
    AnnotationType.CompoundProject -> projectInformationHandler,
    AnnotationType.CompoundTask -> taskInformationHandler,
    AnnotationType.CompoundTaskType -> taskTypeInformationHandler
  ).withDefaultValue(savedTracingInformationHandler)
}

trait AnnotationInformationHandler extends FoxImplicits {

  implicit val ec: ExecutionContext

  def cache: Boolean = true

  def provideAnnotation(identifier: ObjectId, user: Option[User])(implicit ctx: DBAccessContext): Fox[Annotation]

  def nameForAnnotation(t: Annotation)(implicit ctx: DBAccessContext): Fox[String] =
    Fox.successful(t.id)

  def restrictionsFor(identifier: ObjectId)(implicit ctx: DBAccessContext): Fox[AnnotationRestrictions]

  def assertAllOnSameDataset(annotations: List[Annotation]): Fox[Boolean] = {
    @tailrec
    def allOnSameDatasetIter(annotations: List[Annotation], _dataSet: ObjectId): Boolean =
      annotations match {
        case List()       => true
        case head :: tail => head._dataSet == _dataSet && allOnSameDatasetIter(tail, _dataSet)
      }
    annotations match {
      case List() => Fox.successful(true)
      case head :: _ =>
        if (allOnSameDatasetIter(annotations, head._dataSet))
          Fox.successful(true)
        else
          Fox.failure("Cannot create compound annotation spanning multiple datasets")
    }
  }

  def assertNonEmpty[T](seq: List[T]): Fox[Unit] =
    if (seq.isEmpty) Fox.failure("no annotations")
    else Fox.successful(())
}
