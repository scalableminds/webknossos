package models.annotation

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationLayer
import com.typesafe.scalalogging.LazyLogging

import javax.inject.Inject
import models.annotation.AnnotationType.AnnotationType
import models.dataset.DatasetDAO
import models.user.User
import com.scalableminds.util.objectid.ObjectId

import scala.concurrent.ExecutionContext

class AnnotationMerger @Inject()(datasetDAO: DatasetDAO, tracingStoreService: TracingStoreService)(
    implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

  def mergeTwo(
      annotationA: Annotation,
      annotationB: Annotation,
      issuingUser: User
  )(implicit ctx: DBAccessContext): Fox[Annotation] =
    mergeN(
      ObjectId.generate,
      toTemporaryStore = false,
      issuingUser._id,
      annotationB._dataset,
      annotationB._team,
      AnnotationType.Explorational,
      List(annotationA, annotationB)
    )

  def mergeN(
      newId: ObjectId,
      toTemporaryStore: Boolean,
      userId: ObjectId,
      datasetId: ObjectId,
      teamId: ObjectId,
      typ: AnnotationType,
      annotations: List[Annotation]
  )(implicit ctx: DBAccessContext): Fox[Annotation] =
    if (annotations.isEmpty)
      Fox.empty
    else {
      for {
        mergedAnnotationLayers <- mergeAnnotationsInTracingstore(annotations, datasetId, newId, toTemporaryStore) ?~> "Failed to merge annotations in tracingstore."
      } yield {
        Annotation(
          newId,
          datasetId,
          None,
          teamId,
          userId,
          mergedAnnotationLayers,
          typ = typ
        )
      }
    }

  private def mergeAnnotationsInTracingstore(
      annotations: List[Annotation],
      datasetId: ObjectId,
      newAnnotationId: ObjectId,
      toTemporaryStore: Boolean)(implicit ctx: DBAccessContext): Fox[List[AnnotationLayer]] =
    for {
      dataset <- datasetDAO.findOne(datasetId)
      tracingStoreClient: WKRemoteTracingStoreClient <- tracingStoreService.clientFor(dataset)
      mergedAnnotationProto <- tracingStoreClient.mergeAnnotationsByIds(annotations.map(_.id),
                                                                        newAnnotationId,
                                                                        toTemporaryStore)
      layers = mergedAnnotationProto.annotationLayers.map(AnnotationLayer.fromProto)
    } yield layers.toList

}
