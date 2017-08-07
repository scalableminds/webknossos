package models.annotation

import com.scalableminds.braingames.datastore.tracings.{TracingReference, TracingType}
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import models.annotation.AnnotationType.AnnotationType
import models.user.User
import net.liftweb.common.Failure
import oxalis.security.AuthenticatedRequest
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import reactivemongo.bson.BSONObjectID

/**
  * Created by f on 07.08.17.
  */
object AnnotationMerger extends FoxImplicits with LazyLogging {


  def withMergedAnnotation[T](
    typ: AnnotationType,
    id: String,
    mergedId: String,
    mergedTyp: String,
    readOnly: Boolean)(f: Annotation => Fox[T])(implicit request: AuthenticatedRequest[_], ctx: DBAccessContext): Fox[T] = {

    mergeAnnotationsByIdentifiers(AnnotationIdentifier(typ, id), AnnotationIdentifier(mergedTyp, mergedId), readOnly).flatMap(f)
  }

  def mergeAnnotationsByIdentifiers(
    annotationId: AnnotationIdentifier,
    mergedAnnotationId: AnnotationIdentifier,
    readOnly: Boolean)(implicit request: AuthenticatedRequest[_], ctx: DBAccessContext): Fox[Annotation] = {

    val annotation = AnnotationStore.requestAnnotation(annotationId, request.userOpt)
    val annotationSec = AnnotationStore.requestAnnotation(mergedAnnotationId, request.userOpt)

    mergeAnnotations(annotation, annotationSec, readOnly, request.user)
  }

  def mergeAnnotations(
    annotation: Fox[Annotation],
    annotationSec: Fox[Annotation],
    readOnly: Boolean,
    user: User)(implicit ctx: DBAccessContext) = {

    executeAnnotationMerge(annotation, annotationSec, readOnly, user)(ctx)
      .flatten
      .futureBox
      .recover {
        case e =>
          logger.error("AnnotationStore ERROR: " + e)
          e.printStackTrace()
          Failure("AnnotationStore ERROR: " + e)
      }
  }



  private def executeAnnotationMerge(
                                      annotation: Fox[Annotation],
                                      annotationSec: Fox[Annotation],
                                      readOnly: Boolean,
                                      user: User)(implicit ctx: DBAccessContext) = {
    //Todo: rocksDB
     try {
       for {
         ann <- annotation
         annSec <- annotationSec
         newId = BSONObjectID.generate()
         mergedAnnotation = merge(newId, readOnly, user._id, annSec.dataSetName, annSec.team, AnnotationType.Explorational, ann, annSec)
       } yield {
         AnnotationStore.storeMerged(mergedAnnotation, newId)
         mergedAnnotation
       }
     } catch {
       case e: Exception =>
         logger.error("Request Annotation in AnnotationStore failed: " + e)
         throw e
     }
   }


  //TODO: RocksDB
    def merge(
      newId: BSONObjectID,
      readOnly: Boolean,
      _user: BSONObjectID,
      dataSetName: String,
      team: String,
      typ: AnnotationType,
      annotations: Annotation*)(implicit ctx: DBAccessContext): Fox[Annotation] = {

      val restrictions =
        if (readOnly)
          AnnotationRestrictions.readonlyAnnotation()
        else
          AnnotationRestrictions.updateableAnnotation()

      createFromAnnotations(
        newId, Some(_user), dataSetName, team, None,
        annotations.toList, typ, AnnotationState.InProgress, restrictions, AnnotationSettings.default)
    }


  def createFromAnnotations(
                             id: BSONObjectID,
                             _user: Option[BSONObjectID],
                             dataSetName: String,
                             team: String,
                             downloadUrl: Option[String],
                             annotations: List[Annotation],
                             typ: AnnotationType,
                             state: AnnotationState,
                             restrictions: AnnotationRestrictions,
                             settings: AnnotationSettings)(implicit ctx: DBAccessContext): Fox[Annotation] = {
    if (annotations.isEmpty)
      Fox.empty
    else
      Fox.successful(Annotation(
        _user,
        TracingReference("dummy", TracingType.skeletonTracing), //TODO: rocksDB
        dataSetName,
        team,
        settings,
        Json.obj(), //TODO: rocksDB when to recalculate statistics?
        typ,
        false, //TODO: rocksDB what should isActive be?
        state,
        _id = id) //TODO: rocksDB set readOnly from restrictions
      )
  }
}
