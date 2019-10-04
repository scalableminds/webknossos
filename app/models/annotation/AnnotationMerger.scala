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
      tracingStoreClient: TracingStoreRpcClient <- tracingStoreService.clientFor(dataSet)
      (skeletonTracingReference, volumeTracingReference) <- mergeOrDuplicate(tracingStoreClient,
                                                                             persistTracing,
                                                                             annotations)
    } yield {
      (skeletonTracingReference, volumeTracingReference)
    }

  private def mergeOrDuplicate(tracingStoreClient: TracingStoreRpcClient,
                               persistTracing: Boolean,
                               annotations: List[Annotation]): Fox[(Option[String], Option[String])] =
    if (isSingleVolume(annotations))
      for {
        singleVolumeTracingId <- extractSingleVolumeTracingId(annotations) ?~> "Failed to duplicate volume tracing"
        volumeTracingReference <- tracingStoreClient.duplicateVolumeTracing(singleVolumeTracingId) ?~> "Failed to duplicate volume tracing."
      } yield (None, Some(volumeTracingReference))
    else
      for {
        _ <- bool2Fox(containsNoVolumes(annotations))
        skeletonTracingIds = annotations.map(_.skeletonTracingId)
        skeletonTracingReference <- tracingStoreClient.mergeSkeletonTracingsByIds(skeletonTracingIds, persistTracing) ?~> "Failed to merge skeleton tracings."
      } yield (Some(skeletonTracingReference), None)

  private def isSingleVolume(annotations: List[Annotation]): Boolean =
    annotations.flatMap(_.skeletonTracingId).lengthCompare(0) == 0 && annotations
      .flatMap(_.volumeTracingId)
      .lengthCompare(1) == 0

  private def containsNoVolumes(annotations: List[Annotation]): Boolean =
    annotations.flatMap(_.volumeTracingId).isEmpty

  private def extractSingleVolumeTracingId(annotations: List[Annotation]): Fox[String] =
    annotations.flatMap(_.volumeTracingId).headOption.toFox

}
