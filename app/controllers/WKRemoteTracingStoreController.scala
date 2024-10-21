package controllers

import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.models.annotation.AnnotationLayer
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.tracingstore.TracingUpdatesReport
import com.scalableminds.webknossos.tracingstore.tracings.TracingId

import javax.inject.Inject
import models.analytics.{AnalyticsService, UpdateAnnotationEvent, UpdateAnnotationViewOnlyEvent}
import models.annotation.AnnotationState._
import models.annotation.{
  Annotation,
  AnnotationDAO,
  AnnotationInformationProvider,
  AnnotationLayerDAO,
  TracingDataSourceTemporaryStore,
  TracingStoreService
}
import models.dataset.{DatasetDAO, DatasetService}
import models.organization.OrganizationDAO
import models.user.UserDAO
import models.user.time.TimeSpanService
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import security.{WebknossosBearerTokenAuthenticatorService, WkSilhouetteEnvironment}
import utils.{ObjectId, WkConf}

import scala.concurrent.ExecutionContext

class WKRemoteTracingStoreController @Inject()(tracingStoreService: TracingStoreService,
                                               wkSilhouetteEnvironment: WkSilhouetteEnvironment,
                                               timeSpanService: TimeSpanService,
                                               datasetService: DatasetService,
                                               organizationDAO: OrganizationDAO,
                                               userDAO: UserDAO,
                                               annotationInformationProvider: AnnotationInformationProvider,
                                               analyticsService: AnalyticsService,
                                               datasetDAO: DatasetDAO,
                                               annotationDAO: AnnotationDAO,
                                               annotationLayerDAO: AnnotationLayerDAO,
                                               wkConf: WkConf,
                                               tracingDataSourceTemporaryStore: TracingDataSourceTemporaryStore)(
    implicit ec: ExecutionContext,
    playBodyParsers: PlayBodyParsers)
    extends Controller
    with FoxImplicits {

  val bearerTokenService: WebknossosBearerTokenAuthenticatorService =
    wkSilhouetteEnvironment.combinedAuthenticatorService.tokenAuthenticatorService

  def updateAnnotationLayers(name: String, key: String, annotationId: String): Action[List[AnnotationLayer]] =
    Action.async(validateJson[List[AnnotationLayer]]) { implicit request =>
      for {
        annotationIdValidated <- ObjectId.fromString(annotationId)
        existingLayers <- annotationLayerDAO.findAnnotationLayersFor(annotationIdValidated)
        existingLayerIds = existingLayers.map(_.tracingId).toSet
        newLayerIds = request.body.map(_.tracingId).toSet
        layerIdsToDelete = existingLayerIds.diff(newLayerIds)
        layerIdsToUpdate = existingLayerIds.intersect(newLayerIds)
        layerIdsToInsert = newLayerIds.diff(existingLayerIds)
        _ <- Fox.serialCombined(layerIdsToDelete.toList)(
          annotationLayerDAO.deleteOneByTracingId(annotationIdValidated, _))
        _ <- Fox.serialCombined(request.body.filter(l => layerIdsToInsert.contains(l.tracingId)))(
          annotationLayerDAO.insertOne(annotationIdValidated, _))
        _ <- Fox.serialCombined(request.body.filter(l => layerIdsToUpdate.contains(l.tracingId)))(l =>
          annotationLayerDAO.updateName(annotationIdValidated, l.tracingId, l.name))
        // Layer stats are ignored here, they are sent eagerly when saving updates
      } yield Ok
    }

  def handleTracingUpdateReport(name: String, key: String): Action[TracingUpdatesReport] =
    Action.async(validateJson[TracingUpdatesReport]) { implicit request =>
      implicit val ctx: DBAccessContext = GlobalAccessContext
      tracingStoreService.validateAccess(name, key) { _ =>
        val report = request.body
        for {
          annotationId <- ObjectId.fromString(report.annotationId)
          annotation <- annotationDAO.findOne(annotationId)
          _ <- ensureAnnotationNotFinished(annotation)
          _ <- annotationDAO.updateModified(annotation._id, Instant.now)
          /*_ <- Fox.runOptional(report.statistics) { statistics =>
            annotationLayerDAO.updateStatistics(annotation._id, annotationId, statistics)
          }*/ // TODO stats per tracing id. note: they might arrive before the layer is created. skip them then.
          userBox <- bearerTokenService.userForTokenOpt(report.userToken).futureBox
          trackTime = report.significantChangesCount > 0 || !wkConf.WebKnossos.User.timeTrackingOnlyWithSignificantChanges
          _ <- Fox.runOptional(userBox)(user =>
            Fox.runIf(trackTime)(timeSpanService.logUserInteraction(report.timestamps, user, annotation)))
          _ <- Fox.runOptional(userBox)(user =>
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

  def dataSourceForTracing(name: String, key: String, tracingId: String): Action[AnyContent] =
    Action.async { implicit request =>
      tracingStoreService.validateAccess(name, key) { _ =>
        implicit val ctx: DBAccessContext = GlobalAccessContext
        tracingDataSourceTemporaryStore.find(tracingId) match {
          case Some(dataSource) => Fox.successful(Ok(Json.toJson(dataSource)))
          case None =>
            for {
              annotation <- annotationInformationProvider.annotationForTracing(tracingId) ?~> s"No annotation for tracing $tracingId"
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
          annotation <- annotationInformationProvider.annotationForTracing(tracingId) ?~> s"No annotation for tracing $tracingId"
          dataset <- datasetDAO.findOne(annotation._dataset)
          organization <- organizationDAO.findOne(dataset._organization)
        } yield Ok(Json.toJson(DataSourceId(dataset.name, organization._id)))
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

  def dataStoreUriForDataset(name: String,
                             key: String,
                             organizationId: Option[String],
                             datasetName: String): Action[AnyContent] =
    Action.async { implicit request =>
      tracingStoreService.validateAccess(name, key) { _ =>
        implicit val ctx: DBAccessContext = GlobalAccessContext
        for {
          organizationIdWithFallback <- Fox.fillOption(organizationId) {
            datasetDAO.getOrganizationIdForDataset(datasetName)(GlobalAccessContext)
          } ?~> Messages("dataset.noAccess", datasetName) ~> FORBIDDEN
          dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, organizationIdWithFallback) ?~> Messages(
            "dataset.noAccess",
            datasetName) ~> FORBIDDEN
          dataStore <- datasetService.dataStoreFor(dataset)
        } yield Ok(Json.toJson(dataStore.url))
      }
    }
}
