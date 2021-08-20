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
        (mergedSkeletonTracingReference, mergedVolumeTracingReference) <- mergeTracingsOfAnnotations(annotations,
                                                                                                     _dataSet,
                                                                                                     persistTracing)
      } yield {
        Annotation(
          newId,
          _dataSet,
          None,
          _team,
          _user,
          mergedSkeletonTracingReference,
          mergedVolumeTracingReference,
          typ = typ
        )
      }
    }

  private def mergeTracingsOfAnnotations(annotations: List[Annotation], dataSetId: ObjectId, persistTracing: Boolean)(
      implicit ctx: DBAccessContext): Fox[(Option[String], Option[String])] =
    for {
      dataSet <- dataSetDAO.findOne(dataSetId)
      tracingStoreClient: WKRemoteTracingStoreClient <- tracingStoreService.clientFor(dataSet)
      skeletonTracingIds <- Fox.successful(annotations.map(_.skeletonTracingId))
      skeletonTracingReference <- mergeSkeletonTracings(tracingStoreClient, skeletonTracingIds, persistTracing)
      volumeTracingIds <- Fox.successful(annotations.sortBy(_.modified).map(_.volumeTracingId))
      volumeTracingReference <- mergeVolumeTracings(tracingStoreClient, volumeTracingIds, persistTracing)
    } yield (skeletonTracingReference, volumeTracingReference)

  private def mergeSkeletonTracings(tracingStoreClient: WKRemoteTracingStoreClient,
                                    skeletonTracingIds: List[Option[String]],
                                    persistTracing: Boolean) =
    if (skeletonTracingIds.flatten.isEmpty)
      Fox.successful(None)
    else
      tracingStoreClient
        .mergeSkeletonTracingsByIds(skeletonTracingIds, persistTracing)
        .map(Some(_)) ?~> "Failed to merge skeleton tracings."

  private def mergeVolumeTracings(tracingStoreClient: WKRemoteTracingStoreClient,
                                  volumeTracingIds: List[Option[String]],
                                  persistTracing: Boolean) =
    if (volumeTracingIds.flatten.isEmpty)
      Fox.successful(None)
    else
      tracingStoreClient
        .mergeVolumeTracingsByIds(volumeTracingIds, persistTracing)
        .map(Some(_)) ?~> "Failed to merge volume tracings."
}
