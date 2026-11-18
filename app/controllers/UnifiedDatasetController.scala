package controllers

import com.scalableminds.util.Msg
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.accesscontext.GlobalAccessContext
import models.annotation.{AnnotationDAO, AnnotationRestrictionDefaults}
import models.dataset.{CopyDatasetRequest, DatasetDAO, UnifiedDatasetService}
import models.user.UserService
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import play.silhouette.api.Silhouette
import security.{URLSharing, WkEnv}
import utils.WkConf

import javax.inject.Inject
import scala.concurrent.ExecutionContext

// Unified datasets prototype. All actions are only available if features.unifiedDatasets is enabled.
class UnifiedDatasetController @Inject() (
    datasetDAO: DatasetDAO,
    annotationDAO: AnnotationDAO,
    annotationRestrictionDefaults: AnnotationRestrictionDefaults,
    userService: UserService,
    unifiedDatasetService: UnifiedDatasetService,
    conf: WkConf,
    sil: Silhouette[WkEnv]
)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller {

  private def assertFeatureEnabled: Fox[Unit] =
    Fox.fromBool(conf.Features.unifiedDatasets) ?~> "unifiedDatasets.disabled" ~> NOT_FOUND

  // Returns the annotation that holds the dataset's annotation layers, creating an empty one if the requesting user
  // may edit annotation layers and none exists yet.
  def backingAnnotation(datasetId: ObjectId, sharingToken: Option[String]): Action[AnyContent] =
    sil.UserAwareAction.fox { implicit request =>
      val ctx = URLSharing.fallbackTokenAccessContext(sharingToken)
      for {
        _ <- assertFeatureEnabled
        dataset <- datasetDAO.findOne(datasetId)(using ctx) ?~> Msg.Dataset.notFound(datasetId) ~> NOT_FOUND
        info <- unifiedDatasetService.findOrCreateBackingAnnotation(dataset, request.identity)
      } yield Ok(Json.toJson(info))
    }

  // Copies the dataset: data layers are linked (metadata copies pointing at the same data), annotation layers are
  // copied if requested. Any logged-in user who can read the dataset may copy it (D3).
  def copy(datasetId: ObjectId, sharingToken: Option[String]): Action[CopyDatasetRequest] =
    sil.SecuredAction.fox(validateJson[CopyDatasetRequest]) { implicit request =>
      val ctx = URLSharing.fallbackTokenAccessContext(sharingToken)
      for {
        _ <- assertFeatureEnabled
        source <- datasetDAO.findOne(datasetId)(using ctx) ?~> Msg.Dataset.notFound(datasetId) ~> NOT_FOUND
        newDatasetId <- unifiedDatasetService.copyDataset(source, request.identity, request.body)
      } yield Ok(Json.obj("newDatasetId" -> newDatasetId))
    }

  // Lazy conversion (4.6): turns an explorational annotation into a dataset, so that old annotation links redirect to
  // it. Returns the dataset, or null for annotations that are not converted (e.g., task annotations).
  def convertAnnotationToDataset(annotationId: ObjectId): Action[AnyContent] =
    sil.UserAwareAction.fox { implicit request =>
      for {
        _ <- assertFeatureEnabled
        annotation <- annotationDAO.findOne(annotationId)(using
          GlobalAccessContext
        ) ?~> Msg.Annotation.notFound ~> NOT_FOUND
        _ <- Fox.assertTrue(
          annotationRestrictionDefaults.defaultsFor(annotation).allowAccess(request.identity)
        ) ?~> Msg.notAllowed ~> FORBIDDEN
        datasetOpt <- unifiedDatasetService.convertAnnotation(annotationId)
      } yield Ok(
        Json.obj("datasetId" -> datasetOpt.map(_._id), "datasetName" -> datasetOpt.map(_.name))
      )
    }

  // Batch conversion for trying the prototype on a full dev database. Super users only. Take a database dump first,
  // there is no reverse conversion.
  def convertAnnotationsToDatasets(organizationId: Option[String], limit: Option[Int]): Action[AnyContent] =
    sil.SecuredAction.fox { implicit request =>
      for {
        _ <- assertFeatureEnabled
        _ <- userService.assertIsSuperUser(request.identity._multiUser)(using
          GlobalAccessContext
        ) ?~> Msg.notAllowed ~> FORBIDDEN
        report <- unifiedDatasetService.convertAnnotations(organizationId, limit.getOrElse(1000))
      } yield Ok(report)
    }
}
