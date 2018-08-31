package models.annotation

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.annotation.AnnotationType.AnnotationType
import models.binary.{DataSetDAO, DataSetService}
import models.user.User
import play.api.libs.concurrent.Execution.Implicits._
import utils.ObjectId

class AnnotationMerger @Inject()(annotationStore: AnnotationStore,
                                 dataSetDAO: DataSetDAO,
                                 dataSetService: DataSetService
                                ) extends FoxImplicits with LazyLogging {

  def mergeTwoByIds(
                    identifierA: AnnotationIdentifier,
                    identifierB: AnnotationIdentifier,
                    persistTracing: Boolean,
                    issuingUser: User
                   )(implicit ctx: DBAccessContext): Fox[Annotation] = {
    for {
      annotationA: Annotation <- annotationStore.requestAnnotation(identifierA, Some(issuingUser)) ?~> "Request Annotation in AnnotationStore failed"
      annotationB: Annotation <- annotationStore.requestAnnotation(identifierB, Some(issuingUser)) ?~> "Request Annotation in AnnotationStore failed"
      mergedAnnotation <- mergeTwo(annotationA, annotationB, persistTracing, issuingUser)
    } yield mergedAnnotation
  }

  def mergeTwo(
                annotationA: Annotation,
                annotationB: Annotation,
                persistTracing: Boolean,
                issuingUser: User
    )(implicit ctx: DBAccessContext): Fox[Annotation] = {
    mergeN(
      ObjectId.generate,
      persistTracing,
      issuingUser._id,
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
          Some(mergedTracingReference),
          None,
          typ = typ
        )
      }
    }
  }

  private def mergeTracingsOfAnnotations(annotations: List[Annotation], dataSetId: ObjectId, persistTracing: Boolean)(implicit ctx: DBAccessContext): Fox[String] = {
    for {
      dataSet <- dataSetDAO.findOne(dataSetId)
      dataStoreHandler <- dataSetService.handlerFor(dataSet)
      skeletonTracingIds <- Fox.combined(annotations.map(_.skeletonTracingId.toFox))
      tracingReference <- dataStoreHandler.mergeSkeletonTracingsByIds(skeletonTracingIds, persistTracing) ?~> "Failed to merge skeleton tracings."
    } yield {
      tracingReference
    }
  }

}
