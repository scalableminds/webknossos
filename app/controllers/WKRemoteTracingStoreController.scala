package controllers

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.Annotation.AnnotationProto
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationLayer
import com.scalableminds.webknossos.tracingstore.AnnotationUpdatesReport
import com.scalableminds.webknossos.tracingstore.annotation.AnnotationLayerParameters
import com.scalableminds.webknossos.tracingstore.tracings.TracingId
import models.analytics.{AnalyticsService, UpdateAnnotationEvent, UpdateAnnotationViewOnlyEvent}
import models.annotation.AnnotationState._
import models.annotation._
import models.dataset.{DatasetDAO, DatasetService}
import models.organization.OrganizationDAO
import models.user.UserDAO
import models.user.time.TimeSpanService
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import scalapb.GeneratedMessage
import security.{WebknossosBearerTokenAuthenticatorService, WkSilhouetteEnvironment}
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class WKRemoteTracingStoreController @Inject()(tracingStoreService: TracingStoreService,
                                               wkSilhouetteEnvironment: WkSilhouetteEnvironment,
                                               timeSpanService: TimeSpanService,
                                               datasetService: DatasetService,
                                               userDAO: UserDAO,
                                               annotationInformationProvider: AnnotationInformationProvider,
                                               analyticsService: AnalyticsService,
                                               annotationService: AnnotationService,
                                               datasetDAO: DatasetDAO,
                                               annotationDAO: AnnotationDAO,
                                               annotationLayerDAO: AnnotationLayerDAO,
                                               wkConf: WkConf,
                                               annotationDataSourceTemporaryStore: AnnotationDataSourceTemporaryStore)(
    implicit ec: ExecutionContext,
    playBodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  val bearerTokenService: WebknossosBearerTokenAuthenticatorService =
    wkSilhouetteEnvironment.combinedAuthenticatorService.tokenAuthenticatorService

  def updateAnnotation(name: String, key: String, annotationId: ObjectId): Action[AnnotationProto] =
    Action.async(validateProto[AnnotationProto]) { implicit request =>
      // tracingstore only sends this request after ensuring write access
      implicit val ctx: DBAccessContext = GlobalAccessContext
      tracingStoreService.validateAccess(name, key) { _ =>
        for {
          existingLayers <- annotationLayerDAO.findAnnotationLayersFor(annotationId)
          newLayersProto = request.body.annotationLayers
          existingLayerIds = existingLayers.map(_.tracingId).toSet
          newLayerIds = newLayersProto.map(_.tracingId).toSet
          layerIdsToDelete = existingLayerIds.diff(newLayerIds)
          layerIdsToUpdate = existingLayerIds.intersect(newLayerIds)
          layerIdsToInsert = newLayerIds.diff(existingLayerIds)
          _ <- Fox.serialCombined(layerIdsToDelete.toList)(annotationLayerDAO.deleteOneByTracingId(annotationId, _))
          _ <- Fox.serialCombined(newLayersProto.filter(l => layerIdsToInsert.contains(l.tracingId))) { layerProto =>
            annotationLayerDAO.insertOne(annotationId, AnnotationLayer.fromProto(layerProto))
          }
          _ <- Fox.serialCombined(newLayersProto.filter(l => layerIdsToUpdate.contains(l.tracingId)))(l =>
            annotationLayerDAO.updateName(annotationId, l.tracingId, l.name))
          // Layer stats are ignored here, they are sent eagerly when saving updates
          _ <- annotationDAO.updateDescription(annotationId, request.body.description)
        } yield Ok
      }
    }

  def handleTracingUpdateReport(name: String, key: String): Action[AnnotationUpdatesReport] =
    Action.async(validateJson[AnnotationUpdatesReport]) { implicit request =>
      implicit val ctx: DBAccessContext = GlobalAccessContext
      tracingStoreService.validateAccess(name, key) { _ =>
        val report = request.body
        for {
          annotation <- annotationDAO.findOne(report.annotationId)
          _ <- ensureAnnotationNotFinished(annotation)
          _ <- annotationDAO.updateModified(annotation._id, Instant.now)
          _ = report.statistics.map(statistics => annotationService.updateStatistics(annotation._id, statistics))
          userBox <- bearerTokenService.userForTokenOpt(report.userToken).shiftBox
          trackTime = report.significantChangesCount > 0 || !wkConf.WebKnossos.User.timeTrackingOnlyWithSignificantChanges
          _ <- Fox.runOptional(userBox.toOption)(user =>
            Fox.runIf(trackTime)(timeSpanService.logUserInteraction(report.timestamps, user, annotation)))
          _ <- Fox.runOptional(userBox.toOption)(user =>
            Fox.runIf(user._id != annotation._user)(annotationDAO.addContributor(annotation._id, user._id)))
          _ = userBox.map { user =>
            userDAO.updateLastActivity(user._id)
            if (report.significantChangesCount > 0) {
              analyticsService.track(UpdateAnnotationEvent(user, annotation, report.significantChangesCount))
            }
            if (report.viewChangesCount > 0) {
              analyticsService.track(UpdateAnnotationViewOnlyEvent(user, annotation, report.viewChangesCount))
            }
          }
        } yield Ok
      }
    }

  private def ensureAnnotationNotFinished(annotation: Annotation) =
    if (annotation.state == Finished) Fox.failure("annotation already finished")
    else Fox.successful(())

  def dataSourceForAnnotation(name: String, key: String, annotationId: ObjectId): Action[AnyContent] =
    Action.async { implicit request =>
      tracingStoreService.validateAccess(name, key) { _ =>
        implicit val ctx: DBAccessContext = GlobalAccessContext
        annotationDataSourceTemporaryStore.find(annotationId) match {
          case Some(dataSource) => Fox.successful(Ok(Json.toJson(dataSource)))
          case None =>
            for {
              annotation <- annotationDAO.findOne(annotationId) ?~> "annotation.notFound"
              dataset <- datasetDAO.findOne(annotation._dataset) ?~> "dataset.notFound"
              dataSource <- datasetService.dataSourceFor(dataset)
            } yield Ok(Json.toJson(dataSource))
        }
      }
    }

  def datasetIdForAnnotation(name: String, key: String, annotationId: ObjectId): Action[AnyContent] =
    Action.async { implicit request =>
      tracingStoreService.validateAccess(name, key) { _ =>
        implicit val ctx: DBAccessContext = GlobalAccessContext
        for {
          annotation <- annotationDAO.findOne(annotationId) ?~> "annotation.notFound"
          dataset <- datasetDAO.findOne(annotation._dataset) ?~> "dataset.notFound"
        } yield Ok(dataset._id.toString)
      }
    }

  def annotationIdForTracing(name: String, key: String, tracingId: String): Action[AnyContent] =
    Action.async { implicit request =>
      tracingStoreService.validateAccess(name, key) { _ =>
        implicit val ctx: DBAccessContext = GlobalAccessContext
        if (tracingId == TracingId.dummy) {
          Fox.successful(Ok(Json.toJson(ObjectId.dummyId)))
        } else {
          for {
            annotation <- annotationInformationProvider.annotationForTracing(tracingId) ?~> s"No annotation for tracing $tracingId"
          } yield Ok(Json.toJson(annotation._id))
        }
      }
    }

  def dataStoreUriForDataset(name: String, key: String, datasetId: ObjectId): Action[AnyContent] =
    Action.async { implicit request =>
      tracingStoreService.validateAccess(name, key) { _ =>
        implicit val ctx: DBAccessContext = GlobalAccessContext
        for {
          dataset <- datasetDAO.findOne(datasetId) ?~> "dataset.notFound" ~> NOT_FOUND
          dataStore <- datasetService.dataStoreFor(dataset)
        } yield Ok(Json.toJson(dataStore.url))
      }
    }

  def createTracing(name: String,
                    key: String,
                    annotationId: ObjectId,
                    previousVersion: Long): Action[AnnotationLayerParameters] =
    Action.async(validateJson[AnnotationLayerParameters]) { implicit request =>
      tracingStoreService.validateAccess(name, key) { _ =>
        implicit val ctx: DBAccessContext = GlobalAccessContext
        for {
          annotation <- annotationDAO.findOne(annotationId) ?~> "annotation.notFound"
          dataset <- datasetDAO.findOne(annotation._dataset)
          tracingEither <- annotationService.createTracingForExplorational(dataset,
                                                                           request.body,
                                                                           Some(annotation._id),
                                                                           annotation.annotationLayers,
                                                                           Some(previousVersion))
          tracing: GeneratedMessage = tracingEither match {
            case Left(s: SkeletonTracing) => s
            case Right(v: VolumeTracing)  => v
          }
        } yield Ok(tracing.toByteArray).as(protobufMimeType)
      }
    }

}
