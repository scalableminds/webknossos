package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.image.{Color, JPEGWriter}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.helpers.MissingBucketHeaders
import com.scalableminds.webknossos.datastore.image.{ImageCreator, ImageCreatorParameters}
import com.scalableminds.webknossos.datastore.models.DataRequestCollection._
import com.scalableminds.webknossos.datastore.models.{
  DataRequest,
  RawCuboidRequest,
  VoxelPosition,
  WebknossosDataRequest
}
import com.scalableminds.webknossos.datastore.models.requests.{DataServiceDataRequest, DataServiceRequestSettings}
import com.scalableminds.webknossos.datastore.models.datasource.{Category, DataLayer, DataSourceId}
import com.scalableminds.webknossos.datastore.services.{
  BinaryDataService,
  BinaryDataServiceHolder,
  DataSourceRepository,
  DataStoreAccessTokenService,
  DatasetCache,
  FindDataService,
  MappingService,
  UserAccessRequest
}
import com.scalableminds.webknossos.datastore.services.mesh.AdHocMeshServiceHolder
import com.scalableminds.webknossos.datastore.slacknotification.DSSlackNotificationService
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers, RawBuffer}

import java.io.ByteArrayOutputStream
import scala.concurrent.ExecutionContext

/**
  * This is equivalent to the BinaryDataController for Datasets by DatasetId
  */
class WKDatasetController @Inject()(
    accessTokenService: DataStoreAccessTokenService,
    binaryDataServiceHolder: BinaryDataServiceHolder,
    findDataService: FindDataService,
    datasetCache: DatasetCache
)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with MissingBucketHeaders {

  val binaryDataService: BinaryDataService = binaryDataServiceHolder.binaryDataService

  def requestViaWebknossos(datasetId: String, dataLayerName: String): Action[List[WebknossosDataRequest]] =
    Action.async(validateJson[List[WebknossosDataRequest]]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        // TODO Log time
        for {
          datasetId <- ObjectId.fromString(datasetId)
          dataSource <- datasetCache.getById(datasetId)
          dataLayer <- dataSource.getDataLayer(dataLayerName).toFox ?~> "Data layer not found" ~> NOT_FOUND
          (data, indices) <- requestData(dataSource.id, dataLayer, request.body)
        } yield Ok(data).withHeaders(createMissingBucketsHeaders(indices): _*)
      }
    }

  def requestRawCuboid(datasetId: String,
                       dataLayerName: String,
                       x: Int,
                       y: Int,
                       z: Int,
                       width: Int,
                       height: Int,
                       depth: Int,
                       mag: String,
                       halfByte: Boolean,
                       mappingName: Option[String]): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        datasetId <- ObjectId.fromString(datasetId)
        (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
        magParsed <- Vec3Int.fromMagLiteral(mag).toFox ?~> "malformedMag"
        dataRequest = DataRequest(
          VoxelPosition(x, y, z, magParsed),
          width,
          height,
          depth,
          DataServiceRequestSettings(halfByte = halfByte, appliedAgglomerate = mappingName)
        )
        (data, indices) <- requestData(dataSource.id, dataLayer, dataRequest)
      } yield Ok(data).withHeaders(createMissingBucketsHeaders(indices): _*)
    }
  }

  def requestRawCuboidPost(datasetId: String, dataLayerName: String): Action[RawCuboidRequest] =
    Action.async(validateJson[RawCuboidRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          datasetId <- ObjectId.fromString(datasetId)
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          (data, indices) <- requestData(dataSource.id, dataLayer, request.body)
        } yield Ok(data).withHeaders(createMissingBucketsHeaders(indices): _*)
      }
    }

  def thumbnailJpeg(datasetId: String,
                    dataLayerName: String,
                    x: Int,
                    y: Int,
                    z: Int,
                    width: Int,
                    height: Int,
                    mag: String,
                    mappingName: Option[String],
                    intensityMin: Option[Double],
                    intensityMax: Option[Double],
                    color: Option[String],
                    invertColor: Option[Boolean]): Action[RawBuffer] = Action.async(parse.raw) { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        datasetIdValidated <- ObjectId.fromString(datasetId)
        (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetIdValidated, dataLayerName) ?~> Messages(
          "dataSource.notFound") ~> NOT_FOUND
        magParsed <- Vec3Int.fromMagLiteral(mag).toFox ?~> "malformedMag"
        dataRequest = DataRequest(
          VoxelPosition(x, y, z, magParsed),
          width,
          height,
          depth = 1,
          DataServiceRequestSettings(appliedAgglomerate = mappingName)
        )
        (data, _) <- requestData(dataSource.id, dataLayer, dataRequest)
        intensityRange: Option[(Double, Double)] = intensityMin.flatMap(min => intensityMax.map(max => (min, max)))
        layerColor = color.flatMap(Color.fromHTML)
        params = ImageCreatorParameters(
          dataLayer.elementClass,
          useHalfBytes = false,
          slideWidth = width,
          slideHeight = height,
          imagesPerRow = 1,
          blackAndWhite = false,
          intensityRange = intensityRange,
          isSegmentation = dataLayer.category == Category.segmentation,
          color = layerColor,
          invertColor = invertColor
        )
        dataWithFallback = if (data.length == 0)
          new Array[Byte](width * height * dataLayer.bytesPerElement)
        else data
        spriteSheet <- ImageCreator.spriteSheetFor(dataWithFallback, params).toFox ?~> "image.create.failed"
        firstSheet <- spriteSheet.pages.headOption.toFox ?~> "image.page.failed"
        outputStream = new ByteArrayOutputStream()
        _ = new JPEGWriter().writeToOutputStream(firstSheet.image)(outputStream)
      } yield Ok(outputStream.toByteArray).as(jpegMimeType)
    }
  }

  def findData(datasetId: String, dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          datasetIdValidated <- ObjectId.fromString(datasetId)
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetIdValidated, dataLayerName) ~> NOT_FOUND
          positionAndMagOpt <- findDataService.findPositionWithData(dataSource.id, dataLayer)
        } yield Ok(Json.obj("position" -> positionAndMagOpt.map(_._1), "mag" -> positionAndMagOpt.map(_._2)))
      }
    }

  def histogram(datasetId: String, dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          datasetIdValidated <- ObjectId.fromString(datasetId)
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetIdValidated, dataLayerName) ?~> Messages(
            "dataSource.notFound") ~> NOT_FOUND ?~> Messages("histogram.layerMissing", dataLayerName)
          listOfHistograms <- findDataService.createHistogram(dataSource.id, dataLayer) ?~> Messages("histogram.failed",
                                                                                                     dataLayerName)
        } yield Ok(Json.toJson(listOfHistograms))
      }
    }

  private def requestData(
      dataSourceId: DataSourceId,
      dataLayer: DataLayer,
      dataRequests: DataRequestCollection
  )(implicit tc: TokenContext): Fox[(Array[Byte], List[Int])] = {
    val requests =
      dataRequests.map(r => DataServiceDataRequest(Some(dataSourceId), dataLayer, r.cuboid(dataLayer), r.settings))
    binaryDataService.handleDataRequests(requests)
  }
}
