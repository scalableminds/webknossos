package models.annotation

import com.scalableminds.braingames.datastore.tracings.skeleton.TracingSelector
import com.scalableminds.braingames.datastore.tracings.{TracingReference, TracingType}
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import models.annotation.AnnotationType.AnnotationType
import models.binary.DataSetDAO
import models.user.User
import net.liftweb.common.Failure
import oxalis.security.AuthenticatedRequest
import play.api.i18n.Messages
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
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
                readOnly: Boolean
              )(implicit request: AuthenticatedRequest[_], ctx: DBAccessContext): Fox[Annotation] = {

    val identifierA = AnnotationIdentifier(typA, idA)
    val identifierB = AnnotationIdentifier(typB, idB)

    for {
      annotationA: Annotation <- AnnotationStore.requestAnnotation(identifierA, request.userOpt) ?~> "Request Annotation in AnnotationStore failed"
      annotationB: Annotation <- AnnotationStore.requestAnnotation(identifierB, request.userOpt) ?~> "Request Annotation in AnnotationStore failed"
      mergedAnnotation <- mergeTwo(annotationA, annotationB, readOnly)
    } yield mergedAnnotation
  }

  def mergeTwo(
    annotationA: Annotation,
    annotationB: Annotation,
    readOnly: Boolean
    )(implicit request: AuthenticatedRequest[_], ctx: DBAccessContext): Fox[Annotation] = {
    val newId = BSONObjectID.generate()
    mergeN(newId, readOnly, Some(request.user._id), annotationB.dataSetName, annotationB.team, AnnotationType.Explorational, List(annotationA, annotationB))
  }

  def mergeN(
    newId: BSONObjectID,
    readOnly: Boolean,
    _user: Option[BSONObjectID],
    dataSetName: String,
    team: String,
    typ: AnnotationType,
    annotations: List[Annotation])(implicit ctx: DBAccessContext): Fox[Annotation] = {
    if (annotations.isEmpty)
      Fox.empty
    else {
      val mergedAnnotationFox = for {
        mergedTracingReference <- mergeTracingsOfAnnotations(annotations, dataSetName, readOnly)
      } yield {
        Annotation(
          _user,
          mergedTracingReference,
          dataSetName,
          team,
          AnnotationSettings.default,
          Json.obj(), //TODO: rocksDB when to recalculate statistics?
          typ,
          false, //TODO: rocksDB what should isActive be?
          AnnotationState.InProgress,
          _id = newId) //TODO: rocksDB set readOnly from restrictions.. createRestrictions(readOnly)
      }
      AnnotationStore.storeAnnotationInCache(mergedAnnotationFox, newId)
      mergedAnnotationFox
    }
  }

  private def mergeTracingsOfAnnotations(annotations: List[Annotation], dataSetName: String, readOnly: Boolean)(implicit ctx: DBAccessContext): Fox[TracingReference] = {
    val originalTracingSelectors = annotations.map(a => TracingSelector(a.tracingReference.id, None))
    for {
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName)
      dataSource <- dataSet.dataSource.toUsable.toFox
      tracingReference <- dataSet.dataStoreInfo.typ.strategy.mergeSkeletonTracings(dataSet.dataStoreInfo, dataSource, originalTracingSelectors, readOnly) ?~> "Failed to merge skeleton tracings."
    } yield {
      tracingReference
    }
  }

}
