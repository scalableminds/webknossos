package models.annotation

import oxalis.security.WebknossosSilhouette.SecuredRequest
import com.scalableminds.webknossos.datastore.tracings.{TracingReference, TracingType}
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import models.annotation.AnnotationTypeSQL.AnnotationTypeSQL
import models.binary.DataSetDAO
import play.api.libs.concurrent.Execution.Implicits._
import utils.ObjectId

object AnnotationMerger extends FoxImplicits with LazyLogging {

  def mergeTwoByIds(
                    identifierA: AnnotationIdentifier,
                    identifierB: AnnotationIdentifier,
                    persistTracing: Boolean
                   )(implicit request: SecuredRequest[_], ctx: DBAccessContext): Fox[AnnotationSQL] = {
    for {
      annotationA: AnnotationSQL <- AnnotationStore.requestAnnotation(identifierA, Some(request.identity)) ?~> "Request Annotation in AnnotationStore failed"
      annotationB: AnnotationSQL <- AnnotationStore.requestAnnotation(identifierB, Some(request.identity)) ?~> "Request Annotation in AnnotationStore failed"
      mergedAnnotation <- mergeTwo(annotationA, annotationB, persistTracing)
    } yield mergedAnnotation
  }

  def mergeTwo(
    annotationA: AnnotationSQL,
    annotationB: AnnotationSQL,
    persistTracing: Boolean
    )(implicit request: SecuredRequest[_], ctx: DBAccessContext): Fox[AnnotationSQL] = {
    mergeN(
      ObjectId.generate,
      persistTracing,
      ObjectId.fromBsonId(request.identity._id),
      annotationB._dataSet,
      annotationB._team,
      AnnotationTypeSQL.Explorational,
      List(annotationA, annotationB)
    )
  }

  def mergeN(
    newId: ObjectId,
    persistTracing: Boolean,
    _user: ObjectId,
    _dataSet: ObjectId,
    _team: ObjectId,
    typ: AnnotationTypeSQL,
    annotations: List[AnnotationSQL]
    )(implicit ctx: DBAccessContext): Fox[AnnotationSQL] = {
    if (annotations.isEmpty)
      Fox.empty
    else {
      for {
        mergedTracingReference <- mergeTracingsOfAnnotations(annotations, _dataSet, persistTracing)
      } yield {
        AnnotationSQL(
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

  private def mergeTracingsOfAnnotations(annotations: List[AnnotationSQL], dataSetId: ObjectId, persistTracing: Boolean)(implicit ctx: DBAccessContext): Fox[TracingReference] = {
    for {
      dataSet <- DataSetDAO.findOneById(dataSetId)
      dataSource <- dataSet.dataSource.toUsable.toFox
      tracingReference <- dataSet.dataStore.mergeSkeletonTracingsByIds(annotations.map(_.tracing), persistTracing) ?~> "Failed to merge skeleton tracings."
    } yield {
      tracingReference
    }
  }

}
