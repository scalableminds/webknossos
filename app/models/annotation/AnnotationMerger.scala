package models.annotation

import oxalis.security.WebknossosSilhouette.SecuredRequest
import com.scalableminds.webknossos.datastore.tracings.{TracingReference, TracingType}
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import models.annotation.AnnotationType.AnnotationType
import models.binary.DataSetDAO
import play.api.libs.concurrent.Execution.Implicits._
import utils.ObjectId

object AnnotationMerger extends FoxImplicits with LazyLogging {

  def mergeTwoByIds(
                    identifierA: AnnotationIdentifier,
                    identifierB: AnnotationIdentifier,
                    persistTracing: Boolean
                   )(implicit request: SecuredRequest[_], ctx: DBAccessContext): Fox[Annotation] = {
    for {
      annotationA: Annotation <- AnnotationStore.requestAnnotation(identifierA, Some(request.identity)) ?~> "Request Annotation in AnnotationStore failed"
      annotationB: Annotation <- AnnotationStore.requestAnnotation(identifierB, Some(request.identity)) ?~> "Request Annotation in AnnotationStore failed"
      mergedAnnotation <- mergeTwo(annotationA, annotationB, persistTracing)
    } yield mergedAnnotation
  }

  def mergeTwo(
                annotationA: Annotation,
                annotationB: Annotation,
                persistTracing: Boolean
    )(implicit request: SecuredRequest[_], ctx: DBAccessContext): Fox[Annotation] = {
    mergeN(
      ObjectId.generate,
      persistTracing,
      request.identity._id,
      annotationB._dataSet,
      annotationB._team,
      AnnotationType.Explorational,
      List(annotationA, annotationB)
    )
  }

  def mergeN(
              newId: ObjectId,
              persistTracing: Boolean,
              _user: ObjectId,
              _dataSet: ObjectId,
              _team: ObjectId,
              typ: AnnotationType,
              annotations: List[Annotation]
    )(implicit ctx: DBAccessContext): Fox[Annotation] = {
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
          mergedTracingReference,
          typ = typ
        )
      }
    }
  }

  private def mergeTracingsOfAnnotations(annotations: List[Annotation], dataSetId: ObjectId, persistTracing: Boolean)(implicit ctx: DBAccessContext): Fox[TracingReference] = {
    for {
      dataSet <- DataSetDAO.findOne(dataSetId)
      dataStoreHandler <- dataSet.dataStoreHandler
      tracingReference <- dataStoreHandler.mergeSkeletonTracingsByIds(annotations.map(_.tracing), persistTracing) ?~> "Failed to merge skeleton tracings."
    } yield {
      tracingReference
    }
  }

}
