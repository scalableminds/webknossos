package models.annotation

import com.scalableminds.braingames.datastore.tracings.{TracingReference, TracingType}
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import models.annotation.AnnotationType.AnnotationType
import models.binary.DataSetDAO
import oxalis.security.AuthenticatedRequest
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.bson.BSONObjectID

/**
  * Created by f on 07.08.17.
  */
object AnnotationMerger extends FoxImplicits with LazyLogging {

  def mergeTwoByIds(
                idA: String,
                typA: AnnotationType,
                idB: String,
                typB: AnnotationType,
                persistTracing: Boolean
              )(implicit request: AuthenticatedRequest[_], ctx: DBAccessContext): Fox[Annotation] = {

    val identifierA = AnnotationIdentifier(typA, idA)
    val identifierB = AnnotationIdentifier(typB, idB)

    for {
      annotationA: Annotation <- AnnotationStore.requestAnnotation(identifierA, request.userOpt) ?~> "Request Annotation in AnnotationStore failed"
      annotationB: Annotation <- AnnotationStore.requestAnnotation(identifierB, request.userOpt) ?~> "Request Annotation in AnnotationStore failed"
      mergedAnnotation <- mergeTwo(annotationA, annotationB, persistTracing)
    } yield mergedAnnotation
  }

  def mergeTwo(
    annotationA: Annotation,
    annotationB: Annotation,
    persistTracing: Boolean
    )(implicit request: AuthenticatedRequest[_], ctx: DBAccessContext): Fox[Annotation] = {
    val newId = BSONObjectID.generate()
    mergeN(newId, persistTracing, Some(request.user._id), annotationB.dataSetName, annotationB.team, AnnotationType.Explorational, List(annotationA, annotationB))
  }

  def mergeN(
    newId: BSONObjectID,
    persistTracing: Boolean,
    _user: Option[BSONObjectID],
    dataSetName: String,
    team: String,
    typ: AnnotationType,
    annotations: List[Annotation])(implicit ctx: DBAccessContext): Fox[Annotation] = {
    if (annotations.isEmpty)
      Fox.empty
    else {
      for {
        mergedTracingReference <- mergeTracingsOfAnnotations(annotations, dataSetName, persistTracing)
      } yield {
        Annotation(
          _user,
          mergedTracingReference,
          dataSetName,
          team,
          AnnotationSettings.defaultFor(TracingType.skeleton),
          None,
          typ,
          _id = newId)
      }
    }
  }

  private def mergeTracingsOfAnnotations(annotations: List[Annotation], dataSetName: String, persistTracing: Boolean)(implicit ctx: DBAccessContext): Fox[TracingReference] = {
    for {
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName)
      dataSource <- dataSet.dataSource.toUsable.toFox
      tracingReference <- dataSet.dataStore.mergeSkeletonTracingsByIds(annotations.map(_.tracingReference), persistTracing) ?~> "Failed to merge skeleton tracings."
    } yield {
      tracingReference
    }
  }

}
