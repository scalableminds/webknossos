package models.annotation

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.annotation.AnnotationType.AnnotationType
import models.binary.DataSetDAO
import models.user.User
import utils.ObjectId

import scala.concurrent.ExecutionContext

class AnnotationMerger @Inject()(dataSetDAO: DataSetDAO, tracingStoreService: TracingStoreService)(
    implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

  def mergeTwo(
      annotationA: Annotation,
      annotationB: Annotation,
      persistTracing: Boolean,
      issuingUser: User
  )(implicit ctx: DBAccessContext): Fox[Annotation] =
    mergeN(
      ObjectId.generate,
      persistTracing,
      issuingUser._id,
      annotationB._dataSet,
      annotationB._team,
      AnnotationType.Explorational,
      List(annotationA, annotationB)
    )

  def mergeN(
      newId: ObjectId,
      persistTracing: Boolean,
      _user: ObjectId,
      _dataSet: ObjectId,
      _team: ObjectId,
      typ: AnnotationType,
      annotations: List[Annotation]
  )(implicit ctx: DBAccessContext): Fox[Annotation] =
    if (annotations.isEmpty)
      Fox.empty
    else {
      for {
        mergedTracingReference <- mergeTracingsOfAnnotations(annotations, _dataSet, persistTracing)
      } yield {
        Annotation(
          newId,
          _dataSet,
          None,
          _team,
          _user,
          Some(mergedTracingReference),
          None,
          typ = typ
        )
      }
    }

  private def mergeTracingsOfAnnotations(annotations: List[Annotation], dataSetId: ObjectId, persistTracing: Boolean)(
      implicit ctx: DBAccessContext): Fox[String] =
    for {
      dataSet <- dataSetDAO.findOne(dataSetId)
      tracingStoreClient <- tracingStoreService.clientFor(dataSet)
      skeletonTracingIds <- Fox.combined(annotations.map(_.skeletonTracingId.toFox))
      tracingReference <- tracingStoreClient.mergeSkeletonTracingsByIds(skeletonTracingIds, persistTracing) ?~> "Failed to merge skeleton tracings."
    } yield {
      tracingReference
    }

}
