package controllers

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.Annotation.AnnotationProto
import com.scalableminds.webknossos.datastore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationLayer
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
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
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc.{AbstractController, Action, AnyContent, ControllerComponents, PlayBodyParsers}
import scalapb.GeneratedMessage
import security.{WebknossosBearerTokenAuthenticatorService, WkSilhouetteEnvironment}
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class WKRemoteTracingStoreController @Inject() (
    tracingStoreService: TracingStoreService,
    wkSilhouetteEnvironment: WkSilhouetteEnvironment,
    timeSpanService: TimeSpanService,
    datasetService: DatasetService,
    organizationDAO: OrganizationDAO,
    userDAO: UserDAO,
    annotationInformationProvider: AnnotationInformationProvider,
    analyticsService: AnalyticsService,
    annotationService: AnnotationService,
    datasetDAO: DatasetDAO,
    annotationDAO: AnnotationDAO,
    annotationLayerDAO: AnnotationLayerDAO,
    wkConf: WkConf,
    tracingDataSourceTemporaryStore: TracingDataSourceTemporaryStore,
    cc: ControllerComponents
)(implicit ec: ExecutionContext, playBodyParsers: PlayBodyParsers)
    extends AbstractController(cc)
    with WkControllerUtils
    with FoxImplicits {

  val bearerTokenService: WebknossosBearerTokenAuthenticatorService =
    wkSilhouetteEnvironment.combinedAuthenticatorService.tokenAuthenticatorService

  def updateAnnotation(name: String, key: String, annotationId: String): Action[AnnotationProto] =
    Action.async(validateProto[AnnotationProto]) { implicit request =>
      // tracingstore only sends this request after ensuring write access
      implicit val ctx: DBAccessContext = GlobalAccessContext
      tracingStoreService.validateAccess(name, key) { _ =>
        for {
          annotationIdValidated <- ObjectId.fromString(annotationId)
          existingLayers <- annotationLayerDAO.findAnnotationLayersFor(annotationIdValidated)
          newLayersProto = request.body.annotationLayers
          existingLayerIds = existingLayers.map(_.tracingId).toSet
          newLayerIds = newLayersProto.map(_.tracingId).toSet
          layerIdsToDelete = existingLayerIds.diff(newLayerIds)
          layerIdsToUpdate = existingLayerIds.intersect(newLayerIds)
          layerIdsToInsert = newLayerIds.diff(existingLayerIds)
          _ <- Fox.serialCombined(layerIdsToDelete.toList)(
            annotationLayerDAO.deleteOneByTracingId(annotationIdValidated, _)
          )
          _ <- Fox.serialCombined(newLayersProto.filter(l => layerIdsToInsert.contains(l.tracingId))) { layerProto =>
            annotationLayerDAO.insertOne(annotationIdValidated, AnnotationLayer.fromProto(layerProto))
          }
          _ <- Fox.serialCombined(newLayersProto.filter(l => layerIdsToUpdate.contains(l.tracingId)))(l =>
            annotationLayerDAO.updateName(annotationIdValidated, l.tracingId, l.name)
          )
          // Layer stats are ignored here, they are sent eagerly when saving updates
          _ <- annotationDAO.updateDescription(annotationIdValidated, request.body.description)
        } yield Ok
      }
    }

  def handleTracingUpdateReport(name: String, key: String): Action[AnnotationUpdatesReport] =
    Action.async(validateJson[AnnotationUpdatesReport]) { implicit request =>
      implicit val ctx: DBAccessContext = GlobalAccessContext
      tracingStoreService.validateAccess(name, key) { _ =>
        val report = request.body
        for {
          annotationId <- ObjectId.fromString(report.annotationId)
          annotation <- annotationDAO.findOne(annotationId)
          _ <- ensureAnnotationNotFinished(annotation)
          _ <- annotationDAO.updateModified(annotation._id, Instant.now)
          _ = report.statistics.map(statistics => annotationService.updateStatistics(annotation._id, statistics))
          userBox <- bearerTokenService.userForTokenOpt(report.userToken).futureBox
          trackTime =
            report.significantChangesCount > 0 || !wkConf.WebKnossos.User.timeTrackingOnlyWithSignificantChanges
          _ <- Fox.runOptional(userBox)(user =>
            Fox.runIf(trackTime)(timeSpanService.logUserInteraction(report.timestamps, user, annotation))
          )
          _ <- Fox.runOptional(userBox)(user =>
            Fox.runIf(user._id != annotation._user)(annotationDAO.addContributor(annotation._id, user._id))
          )
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

  def dataSourceForTracing(name: String, key: String, tracingId: String): Action[AnyContent] =
    Action.async { implicit request =>
      tracingStoreService.validateAccess(name, key) { _ =>
        implicit val ctx: DBAccessContext = GlobalAccessContext
        tracingDataSourceTemporaryStore.find(tracingId) match {
          case Some(dataSource) => Fox.successful(Ok(Json.toJson(dataSource)))
          case None =>
            for {
              annotation <- annotationInformationProvider.annotationForTracing(
                tracingId
              ) ?~> s"No annotation for tracing $tracingId"
              dataset <- datasetDAO.findOne(annotation._dataset)
              dataSource <- datasetService.dataSourceFor(dataset)
            } yield Ok(Json.toJson(dataSource))
        }
      }
    }

  def dataSourceIdForTracing(name: String, key: String, tracingId: String): Action[AnyContent] =
    Action.async { implicit request =>
      tracingStoreService.validateAccess(name, key) { _ =>
        implicit val ctx: DBAccessContext = GlobalAccessContext
        for {
          annotation <- annotationInformationProvider.annotationForTracing(
            tracingId
          ) ?~> s"No annotation for tracing $tracingId"
          dataset <- datasetDAO.findOne(annotation._dataset)
          organization <- organizationDAO.findOne(dataset._organization)
        } yield Ok(Json.toJson(DataSourceId(dataset.directoryName, organization._id)))
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
            annotation <- annotationInformationProvider.annotationForTracing(
              tracingId
            ) ?~> s"No annotation for tracing $tracingId"
          } yield Ok(Json.toJson(annotation._id))
        }
      }
    }

  def dataStoreUriForDataset(
      name: String,
      key: String,
      organizationId: Option[String],
      datasetDirectory: String
  ): Action[AnyContent] =
    Action.async { implicit request =>
      tracingStoreService.validateAccess(name, key) { _ =>
        implicit val ctx: DBAccessContext = GlobalAccessContext
        for {
          organizationIdWithFallback <- Fox.fillOption(organizationId) {
            datasetDAO.getOrganizationIdForDataset(datasetDirectory)(GlobalAccessContext)
          } ?~> Messages("dataset.noAccess", datasetDirectory) ~> FORBIDDEN
          dataset <- datasetDAO.findOneByDirectoryNameAndOrganization(
            datasetDirectory,
            organizationIdWithFallback
          ) ?~> Messages("dataset.noAccess", datasetDirectory) ~> FORBIDDEN
          dataStore <- datasetService.dataStoreFor(dataset)
        } yield Ok(Json.toJson(dataStore.url))
      }
    }

  def createTracing(
      name: String,
      key: String,
      annotationId: String,
      previousVersion: Long
  ): Action[AnnotationLayerParameters] =
    Action.async(validateJson[AnnotationLayerParameters]) { implicit request =>
      tracingStoreService.validateAccess(name, key) { _ =>
        implicit val ctx: DBAccessContext = GlobalAccessContext
        for {
          annotationIdValidated <- ObjectId.fromString(annotationId)
          annotation <- annotationDAO.findOne(annotationIdValidated) ?~> "annotation.notFound"
          dataset <- datasetDAO.findOne(annotation._dataset)
          tracingEither <- annotationService.createTracingForExplorational(
            dataset,
            request.body,
            Some(annotation._id),
            annotation.annotationLayers,
            Some(previousVersion)
          )
          tracing: GeneratedMessage = tracingEither match {
            case Left(s: SkeletonTracing) => s
            case Right(v: VolumeTracing)  => v
          }
        } yield Ok(tracing.toByteArray).as(protobufMimeType)
      }
    }

}
