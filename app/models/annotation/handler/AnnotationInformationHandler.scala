package models.annotation.handler

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}

import javax.inject.Inject
import models.annotation.AnnotationType.AnnotationType
import models.annotation._
import models.user.User
import com.scalableminds.util.objectid.ObjectId
import models.dataset.{DatasetDAO, DatasetService}

import scala.annotation.{nowarn, tailrec}
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

  def datasetDAO: DatasetDAO
  def datasetService: DatasetService
  def annotationDataSourceTemporaryStore: AnnotationDataSourceTemporaryStore

  implicit val ec: ExecutionContext

  def useCache: Boolean = true

  def provideAnnotation(identifier: ObjectId, user: Option[User])(implicit ctx: DBAccessContext): Fox[Annotation]

  @nowarn // suppress warning about unused implicit ctx, as it is used in subclasses
  def nameForAnnotation(t: Annotation)(implicit ctx: DBAccessContext): Fox[String] =
    Fox.successful(t.id)

  def restrictionsFor(identifier: ObjectId)(implicit ctx: DBAccessContext): Fox[AnnotationRestrictions]

  def assertAllOnSameDataset(annotations: List[Annotation]): Fox[Boolean] = {
    @tailrec
    def allOnSameDatasetIter(annotations: List[Annotation], datasetId: ObjectId): Boolean =
      annotations match {
        case List()       => true
        case head :: tail => head._dataset == datasetId && allOnSameDatasetIter(tail, datasetId)
      }

    annotations match {
      case List() => Fox.successful(true)
      case head :: _ =>
        if (allOnSameDatasetIter(annotations, head._dataset))
          Fox.successful(true)
        else
          Fox.failure("Cannot create compound annotation spanning multiple datasets")
    }
  }

  def assertNonEmpty[T](seq: List[T]): Fox[Unit] =
    if (seq.isEmpty) Fox.failure("no annotations")
    else Fox.successful(())

  protected def registerDataSourceInTemporaryStore(temporaryAnnotationId: ObjectId, datasetId: ObjectId): Fox[Unit] =
    for {
      dataset <- datasetDAO.findOne(datasetId)(GlobalAccessContext) ?~> "dataset.notFoundForAnnotation"
      dataSource <- datasetService.dataSourceFor(dataset).flatMap(_.toUsable.toFox) ?~> "dataset.dataSource.notUsable"
      _ = annotationDataSourceTemporaryStore.store(temporaryAnnotationId, dataSource)
    } yield ()
}
