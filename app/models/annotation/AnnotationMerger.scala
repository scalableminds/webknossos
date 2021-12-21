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
        mergedAnnotationLayers <- mergeTracingsOfAnnotations(annotations, _dataSet, persistTracing)
      } yield {
        Annotation(
          newId,
          _dataSet,
          None,
          _team,
          _user,
          mergedAnnotationLayers,
          typ = typ
        )
      }
    }

  private def mergeTracingsOfAnnotations(annotations: List[Annotation], dataSetId: ObjectId, persistTracing: Boolean)(
      implicit ctx: DBAccessContext): Fox[List[AnnotationLayer]] =
    for {
      dataSet <- dataSetDAO.findOne(dataSetId)
      tracingStoreClient: WKRemoteTracingStoreClient <- tracingStoreService.clientFor(dataSet)
      skeletonLayers = annotations.flatMap(_.annotationLayers.find(_.typ == AnnotationLayerType.Skeleton))
      volumeLayers = annotations.flatMap(_.annotationLayers.find(_.typ == AnnotationLayerType.Volume))
      mergedSkeletonTracingId <- mergeSkeletonTracings(tracingStoreClient,
                                                       skeletonLayers.map(_.tracingId),
                                                       persistTracing)
      mergedVolumeTracingId <- mergeVolumeTracings(tracingStoreClient, volumeLayers.map(_.tracingId), persistTracing)
      mergedSkeletonName = allEqual(skeletonLayers.flatMap(_.name))
      mergedVolumeName = allEqual(volumeLayers.flatMap(_.name))
      mergedSkeletonLayer = mergedSkeletonTracingId.map(id =>
        AnnotationLayer(id, AnnotationLayerType.Skeleton, mergedSkeletonName))
      mergedVolumeLayer = mergedVolumeTracingId.map(id =>
        AnnotationLayer(id, AnnotationLayerType.Volume, mergedVolumeName))
    } yield List(mergedSkeletonLayer, mergedVolumeLayer).flatten

  private def allEqual(str: List[String]): Option[String] =
    // returns the str if all names are equal, None otherwise
    str.headOption.map(name => str.forall(_ == name)).flatMap { _ =>
      str.headOption
    }

  private def mergeSkeletonTracings(tracingStoreClient: WKRemoteTracingStoreClient,
                                    skeletonTracingIds: List[String],
                                    persistTracing: Boolean) =
    if (skeletonTracingIds.isEmpty)
      Fox.successful(None)
    else
      tracingStoreClient
        .mergeSkeletonTracingsByIds(skeletonTracingIds, persistTracing)
        .map(Some(_)) ?~> "Failed to merge skeleton tracings."

  private def mergeVolumeTracings(tracingStoreClient: WKRemoteTracingStoreClient,
                                  volumeTracingIds: List[String],
                                  persistTracing: Boolean) =
    if (volumeTracingIds.isEmpty)
      Fox.successful(None)
    else
      tracingStoreClient
        .mergeVolumeTracingsByIds(volumeTracingIds, persistTracing)
        .map(Some(_)) ?~> "Failed to merge volume tracings."
}
