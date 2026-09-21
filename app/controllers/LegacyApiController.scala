package controllers

import com.scalableminds.util.Msg
import play.silhouette.api.Silhouette
import play.silhouette.api.actions.UserAwareRequest
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.helpers.UnsignedLong
import models.dataset.{DataStoreDAO, Dataset, DatasetDAO, DatasetService}
import models.organization.OrganizationDAO
import models.user.{User, UserDAO, UserService}

import javax.inject.Inject
import play.api.http.HttpEntity
import play.api.libs.json.*
import play.api.mvc.{Action, AnyContent, PlayBodyParsers, Result}
import security.WkEnv
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.webknossos.datastore.models.datasource.{
  StaticColorLayer,
  StaticSegmentationLayer,
  UsableDataSource
}
import models.analytics.{AnalyticsService, ChangeDatasetSettingsEvent}
import utils.MetadataAssertions

import scala.concurrent.ExecutionContext

class LegacyApiController @Inject() (
    datasetController: DatasetController,
    datasetService: DatasetService,
    datasetDAO: DatasetDAO,
    dataStoreDAO: DataStoreDAO,
    organizationDAO: OrganizationDAO,
    userService: UserService,
    userDAO: UserDAO,
    analyticsService: AnalyticsService,
    sil: Silhouette[WkEnv]
)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with MetadataAssertions {

  /* provide v15 */

  def listV15(
      isActive: Option[Boolean],
      isUnreported: Option[Boolean],
      organizationId: Option[String],
      onlyMyOrganization: Option[Boolean],
      uploaderId: Option[ObjectId],
      folderId: Option[ObjectId],
      includeSubfolders: Option[Boolean],
      searchQuery: Option[String],
      limit: Option[Int],
      compact: Option[Boolean]
  ): Action[AnyContent] = sil.UserAwareAction.fox { implicit request =>
    dispatchListByCompact(
      isActive,
      isUnreported,
      organizationId,
      onlyMyOrganization,
      uploaderId,
      folderId,
      includeSubfolders,
      searchQuery,
      limit,
      compact
    )
  }

  /* provide v14 */

  def readV14(datasetId: ObjectId, sharingToken: Option[String]): Action[AnyContent] =
    sil.UserAwareAction.fox { implicit request =>
      for {
        result <- Fox.fromFuture(datasetController.read(datasetId, sharingToken)(request))
        adaptedResult <- replaceInResult(downgradeLargestSegmentIdsIfSafeFox)(result)
      } yield adaptedResult
    }

  def listV14(
      isActive: Option[Boolean],
      isUnreported: Option[Boolean],
      organizationId: Option[String],
      onlyMyOrganization: Option[Boolean],
      uploaderId: Option[ObjectId],
      folderId: Option[ObjectId],
      includeSubfolders: Option[Boolean],
      searchQuery: Option[String],
      limit: Option[Int],
      compact: Option[Boolean]
  ): Action[AnyContent] = sil.UserAwareAction.fox { implicit request =>
    for {
      result <- dispatchListByCompact(
        isActive,
        isUnreported,
        organizationId,
        onlyMyOrganization,
        uploaderId,
        folderId,
        includeSubfolders,
        searchQuery,
        limit,
        compact
      )
      adaptedResult <- replaceInResult(downgradeLargestSegmentIdsIfSafeFox)(result)
    } yield adaptedResult
  }

  def updatePartialV14(datasetId: ObjectId): Action[DatasetUpdatePartialParameters] =
    sil.SecuredAction.fox(validateJson[DatasetUpdatePartialParameters]) { implicit request =>
      for {
        result <- Fox.fromFuture(datasetController.updatePartial(datasetId)(request))
        adaptedResult <- replaceInResult(downgradeLargestSegmentIdsIfSafeFox)(result)
      } yield adaptedResult
    }

  def reserveUploadToPathsV14(): Action[ReserveDatasetUploadToPathsRequest] =
    sil.SecuredAction.fox(validateJson[ReserveDatasetUploadToPathsRequest]) { implicit request =>
      for {
        result <- Fox.fromFuture(datasetController.reserveUploadToPaths()(request))
        adaptedResult <- replaceInResult(downgradeLargestSegmentIdsIfSafeFox)(result)
      } yield adaptedResult
    }

  def reserveUploadToPathsForPreliminaryV14(
      datasetId: ObjectId
  ): Action[ReserveDatasetUploadToPathsForPreliminaryRequest] =
    sil.SecuredAction.fox(validateJson[ReserveDatasetUploadToPathsForPreliminaryRequest]) { implicit request =>
      for {
        result <- Fox.fromFuture(datasetController.reserveUploadToPathsForPreliminary(datasetId)(request))
        adaptedResult <- replaceInResult(downgradeLargestSegmentIdsIfSafeFox)(result)
      } yield adaptedResult
    }

  /* provide v12 */

  def updatePartialV12(datasetId: ObjectId): Action[DatasetUpdatePartialParameters] =
    sil.SecuredAction.fox(validateJson[DatasetUpdatePartialParameters]) { implicit request =>
      for {
        dataset <- datasetDAO.findOne(datasetId) ?~> Msg.Dataset.notFound(datasetId) ~> NOT_FOUND
        _ <- Fox.assertTrue(
          datasetService.isEditableBy(dataset, Some(request.identity))
        ) ?~> Msg.notAllowed ~> FORBIDDEN
        _ <- Fox.runOptional(request.body.metadata)(assertNoDuplicateMetadataKeys)
        _ <- datasetDAO.updatePartial(dataset._id, request.body)
        _ <- Fox.runOptional(request.body.dataSource) { dataSourceUpdates =>
          def findOriginalAttachments(existingDataSource: UsableDataSource, layerName: String) = {
            val reverseLayerRenamingMap: Map[String, String] = request.body.layerRenamings
              .getOrElse(Seq.empty)
              .map(layerRenaming => (layerRenaming.newName, layerRenaming.oldName))
              .toMap
            val existingLayerName = reverseLayerRenamingMap.getOrElse(layerName, layerName)
            val existingLayer = existingDataSource.dataLayers.find(_.name == existingLayerName)
            existingLayer.flatMap(_.attachments)
          }
          for {
            existingDataSource <- datasetService.usableDataSourceFor(dataset)
            updatesWithUndoneAttachmentChanges = dataSourceUpdates.copy(
              dataLayers = dataSourceUpdates.dataLayers.map {
                case s: StaticColorLayer => s.copy(attachments = findOriginalAttachments(existingDataSource, s.name))
                case s: StaticSegmentationLayer =>
                  s.copy(attachments = findOriginalAttachments(existingDataSource, s.name))
              }
            )
            _ <- datasetService.updateDataSourceFromUserChanges(
              dataset,
              updatesWithUndoneAttachmentChanges,
              request.body.layerRenamings.getOrElse(Seq.empty),
              request.body.attachmentRenamings.getOrElse(Seq.empty)
            )
          } yield ()
        }
        updated <- datasetDAO.findOne(datasetId)
        _ = analyticsService.track(ChangeDatasetSettingsEvent(request.identity, updated))
        jsRaw <- datasetService.publicWrites(updated, Some(request.identity))
        jsAdapted = downgradeLargestSegmentIdsIfSafe(jsRaw)
      } yield Ok(jsAdapted)
    }

  /* private helper methods for legacy adaptation */

  // For legacy API versions (v10-v15), replicates the pre-v16 compact-param dispatch that used
  // to live in DatasetController.list: compact=true uses the (now default) compact format,
  // anything else uses the old full/grouped format via listFull below.
  private def dispatchListByCompact(
      isActive: Option[Boolean],
      isUnreported: Option[Boolean],
      organizationId: Option[String],
      onlyMyOrganization: Option[Boolean],
      uploaderId: Option[ObjectId],
      folderId: Option[ObjectId],
      includeSubfolders: Option[Boolean],
      searchQuery: Option[String],
      limit: Option[Int],
      compact: Option[Boolean]
  )(implicit request: UserAwareRequest[WkEnv, AnyContent]): Fox[Result] =
    if (compact.getOrElse(false))
      Fox.fromFuture(
        datasetController.list(
          isActive,
          isUnreported,
          organizationId,
          onlyMyOrganization,
          uploaderId,
          folderId,
          includeSubfolders,
          searchQuery,
          limit
        )(request)
      )
    else
      listFull(
        isActive,
        isUnreported,
        organizationId,
        onlyMyOrganization,
        uploaderId,
        folderId,
        includeSubfolders,
        searchQuery,
        limit
      )

  private def listFull(
      isActive: Option[Boolean],
      isUnreported: Option[Boolean],
      organizationId: Option[String],
      onlyMyOrganization: Option[Boolean],
      uploaderId: Option[ObjectId],
      folderId: Option[ObjectId],
      recursive: Option[Boolean],
      searchQuery: Option[String],
      limit: Option[Int]
  )(implicit request: UserAwareRequest[WkEnv, AnyContent]): Fox[Result] =
    for {
      organizationIdOpt =
        if (onlyMyOrganization.getOrElse(false))
          request.identity.map(_._organization)
        else
          organizationId
      datasets <- datasetDAO.findAllWithSearch(
        isActive,
        isUnreported,
        organizationIdOpt,
        folderId,
        uploaderId,
        searchQuery,
        recursive.getOrElse(false),
        limit
      ) ?~> Msg.Dataset.List.failed
      js <- listGrouped(datasets, request.identity) ?~> Msg.Dataset.List.groupingFailed
      _ = Fox.runOptional(request.identity)(user => userDAO.updateLastActivity(user._id))
    } yield addRemoteOriginHeaders(Ok(Json.toJson(js)))

  private def listGrouped(datasets: List[Dataset], requestingUser: Option[User])(using
      ctx: DBAccessContext
  ): Fox[List[JsObject]] =
    for {
      requestingUserTeamManagerMemberships <- Fox.runOptional(requestingUser)(user =>
        userService.teamManagerMembershipsFor(user._id)
      )
      groupedByOrga = datasets.groupBy(_._organization).toList
      js <- Fox.serialCombined(groupedByOrga) { (byOrgaTuple: (String, List[Dataset])) =>
        for {
          organization <- organizationDAO.findOne(byOrgaTuple._1)(using GlobalAccessContext) ?~> Msg.Organization
            .notFound(byOrgaTuple._1)
          groupedByDataStore = byOrgaTuple._2.groupBy(_._dataStore).toList
          result <- Fox.serialCombined(groupedByDataStore) { (byDataStoreTuple: (String, List[Dataset])) =>
            for {
              dataStore <- dataStoreDAO.findOneByName(byDataStoreTuple._1.trim)(using GlobalAccessContext)
              resultByDataStore: Seq[JsObject] <- Fox.serialCombined(byDataStoreTuple._2) { d =>
                datasetService.publicWrites(
                  d,
                  requestingUser,
                  Some(organization),
                  Some(dataStore),
                  requestingUserTeamManagerMemberships
                ) ?~> Msg.Dataset.publicWritesFailed(d._id)
              }
            } yield resultByDataStore
          }
        } yield result.flatten
      }
    } yield js.flatten

  // For API versions <= 14, largestSegmentId must keep being written as a plain JsNumber
  // whenever that does not lose precision, for backwards compatibility with clients that
  // do not understand the newer UnsignedLong bigint envelope (see UnsignedLong.scala).
  private def downgradeLargestSegmentIdsIfSafe(jsObject: JsObject): JsObject =
    JsonHelper.patchKeyRecursively(jsObject, "largestSegmentId")(UnsignedLong.downgradeToPlainNumberIfSafe).as[JsObject]

  private def downgradeLargestSegmentIdsIfSafeFox(jsObject: JsObject): Fox[JsObject] =
    Fox.successful(downgradeLargestSegmentIdsIfSafe(jsObject))

  private def replaceInResult(replacement: JsObject => Fox[JsObject])(result: Result): Fox[Result] =
    if (result.header.status == 200) {
      result.body match {
        case HttpEntity.Strict(data, _) =>
          for {
            bodyJsValue <- JsonHelper.parseAs[JsValue](data.toArray).toFox
            newJson <- bodyJsValue match {
              case JsArray(value) =>
                for { valueList <- Fox.serialCombined(value.toList)(el => replacement(el.as[JsObject])) } yield Json
                  .toJson(valueList)
              case jsObj: JsObject => replacement(jsObj)
              case v: JsValue      => Fox.successful(v)
            }
          } yield Ok(Json.toJson(newJson)).copy(header = result.header)
        case _ => Fox.successful(BadRequest)
      }
    } else Fox.successful(result)

}
