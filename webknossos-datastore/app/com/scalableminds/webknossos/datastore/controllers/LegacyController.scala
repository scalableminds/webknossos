package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.dataformats.zarr.Zarr3OutputHelper
import com.scalableminds.webknossos.datastore.helpers.MissingBucketHeaders
import com.scalableminds.webknossos.datastore.models.{
  RawCuboidRequest,
  WebknossosAdHocMeshRequest,
  WebknossosDataRequest
}
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId

import com.scalableminds.webknossos.datastore.services.mapping.MappingService
import com.scalableminds.webknossos.datastore.services.mesh.{
  AdHocMeshService,
  AdHocMeshServiceHolder,
  DSFullMeshService,
  FullMeshRequest
}
import com.scalableminds.webknossos.datastore.services.{
  BinaryDataService,
  BinaryDataServiceHolder,
  DSRemoteWebknossosClient,
  DataSourceRepository,
  DataStoreAccessTokenService,
  UserAccessRequest
}
import play.api.mvc.{Action, AnyContent, PlayBodyParsers, RawBuffer}

import scala.concurrent.ExecutionContext

class LegacyController @Inject()(
    dataSourceRepository: DataSourceRepository,
    accessTokenService: DataStoreAccessTokenService,
    binaryDataServiceHolder: BinaryDataServiceHolder,
    remoteWebknossosClient: DSRemoteWebknossosClient,
    mappingService: MappingService,
    config: DataStoreConfig,
    adHocMeshServiceHolder: AdHocMeshServiceHolder,
    fullMeshService: DSFullMeshService,
    binaryDataController: BinaryDataController,
    zarrStreamingController: ZarrStreamingController,
    dataSourceController: DataSourceController
)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with Zarr3OutputHelper
    with MissingBucketHeaders {

  // BINARY DATA ROUTES

  override def allowRemoteOrigin: Boolean = true

  val binaryDataService: BinaryDataService = binaryDataServiceHolder.binaryDataService
  adHocMeshServiceHolder.dataStoreAdHocMeshConfig =
    (binaryDataService, mappingService, config.Datastore.AdHocMesh.timeout, config.Datastore.AdHocMesh.actorPoolSize)
  val adHocMeshService: AdHocMeshService = adHocMeshServiceHolder.dataStoreAdHocMeshService

  def requestViaWebknossosV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String
  ): Action[List[WebknossosDataRequest]] = Action.async(validateJson[List[WebknossosDataRequest]]) { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        datasetId <- remoteWebknossosClient.getDatasetId(organizationId, datasetDirectoryName)
        result <- Fox.fromFuture(binaryDataController.requestViaWebknossos(datasetId, dataLayerName)(request))
      } yield result
    }
  }

  def requestRawCuboidV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      // Mag1 coordinates of the top-left corner of the bounding box
      x: Int,
      y: Int,
      z: Int,
      // Target-mag size of the bounding box
      width: Int,
      height: Int,
      depth: Int,
      // Mag in three-component format (e.g. 1-1-1 or 16-16-8)
      mag: String,
      // If true, use lossy compression by sending only half-bytes of the data
      halfByte: Boolean,
      mappingName: Option[String]
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        datasetId <- remoteWebknossosClient.getDatasetId(organizationId, datasetDirectoryName)
        result <- Fox.fromFuture(
          binaryDataController.requestRawCuboid(
            datasetId,
            dataLayerName,
            x,
            y,
            z,
            width,
            height,
            depth,
            mag,
            halfByte,
            mappingName
          )(request))
      } yield result
    }
  }

  def requestRawCuboidPostV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String
  ): Action[RawCuboidRequest] = Action.async(validateJson[RawCuboidRequest]) { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        datasetId <- remoteWebknossosClient.getDatasetId(organizationId, datasetDirectoryName)
        result <- Fox.fromFuture(
          binaryDataController.requestRawCuboidPost(
            datasetId,
            dataLayerName
          )(request))
      } yield result
    }
  }

  def requestViaKnossosV9(organizationId: String,
                          datasetDirectoryName: String,
                          dataLayerName: String,
                          mag: Int,
                          x: Int,
                          y: Int,
                          z: Int,
                          cubeSize: Int): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        datasetId <- remoteWebknossosClient.getDatasetId(organizationId, datasetDirectoryName)
        result <- Fox.fromFuture(
          binaryDataController.requestViaKnossos(
            datasetId,
            dataLayerName,
            mag,
            x,
            y,
            z,
            cubeSize
          )(request))
      } yield result
    }
  }

  def thumbnailJpegV9(organizationId: String,
                      datasetDirectoryName: String,
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
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        datasetId <- remoteWebknossosClient.getDatasetId(organizationId, datasetDirectoryName)
        result <- Fox.fromFuture {
          binaryDataController.thumbnailJpeg(
            datasetId,
            dataLayerName,
            x,
            y,
            z,
            width,
            height,
            mag,
            mappingName,
            intensityMin,
            intensityMax,
            color,
            invertColor
          )(request)
        }
      } yield result
    }
  }

  def mappingJsonV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mappingName: String
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        datasetId <- remoteWebknossosClient.getDatasetId(organizationId, datasetDirectoryName)
        mapping <- Fox.fromFuture(
          binaryDataController.mappingJson(
            datasetId,
            dataLayerName,
            mappingName
          )(request)
        )
      } yield mapping
    }
  }

  /**
    * Handles ad-hoc mesh requests.
    */
  def requestAdHocMeshV9(organizationId: String,
                         datasetDirectoryName: String,
                         dataLayerName: String): Action[WebknossosAdHocMeshRequest] =
    Action.async(validateJson[WebknossosAdHocMeshRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
        for {
          datasetId <- remoteWebknossosClient.getDatasetId(organizationId, datasetDirectoryName)
          result <- Fox.fromFuture(
            binaryDataController.requestAdHocMesh(
              datasetId,
              dataLayerName
            )(request)
          )
        } yield result
      }
    }

  def findDataV9(organizationId: String, datasetDirectoryName: String, dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
        for {
          datasetId <- remoteWebknossosClient.getDatasetId(organizationId, datasetDirectoryName)
          result <- Fox.fromFuture(
            binaryDataController.findData(
              datasetId,
              dataLayerName
            )(request))
        } yield result
      }
    }

  def histogramV9(organizationId: String, datasetDirectoryName: String, dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
        for {
          datasetId <- remoteWebknossosClient.getDatasetId(organizationId, datasetDirectoryName)
          result <- Fox.fromFuture(
            binaryDataController.histogram(
              datasetId,
              dataLayerName
            )(request))
        } yield result
      }
    }

  // ZARR ROUTES

  def requestZAttrsV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String = "",
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        datasetId <- remoteWebknossosClient.getDatasetId(organizationId, datasetDirectoryName)
        result <- Fox.fromFuture(zarrStreamingController.requestZAttrs(datasetId, dataLayerName)(request))
      } yield result
    }
  }

  def requestZarrJsonV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String = "",
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        datasetId <- remoteWebknossosClient.getDatasetId(organizationId, datasetDirectoryName)
        result <- Fox.fromFuture(zarrStreamingController.requestZarrJson(datasetId, dataLayerName)(request))
      } yield result
    }
  }

  /**
    * Zarr-specific datasource-properties.json file for a datasource.
    * Note that the result here is not necessarily equal to the file used in the underlying storage.
    */
  def requestDataSourceV9(
      organizationId: String,
      datasetDirectoryName: String,
      zarrVersion: Int,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        datasetId <- remoteWebknossosClient.getDatasetId(organizationId, datasetDirectoryName)
        result <- Fox.fromFuture(zarrStreamingController.requestDataSource(datasetId, zarrVersion)(request))
      } yield result
    }
  }

  def requestRawZarrCubeV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mag: String,
      coordinates: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        datasetId <- remoteWebknossosClient.getDatasetId(organizationId, datasetDirectoryName)
        result <- Fox.fromFuture(
          zarrStreamingController.requestRawZarrCube(
            datasetId,
            dataLayerName,
            mag,
            coordinates
          )(request))
      } yield result
    }
  }

  def requestZArrayV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mag: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        datasetId <- remoteWebknossosClient.getDatasetId(organizationId, datasetDirectoryName)
        result <- Fox.fromFuture(zarrStreamingController.requestZArray(datasetId, dataLayerName, mag)(request))
      } yield result
    }
  }

  def requestZarrJsonForMagV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mag: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        datasetId <- remoteWebknossosClient.getDatasetId(organizationId, datasetDirectoryName)
        result <- Fox.fromFuture(zarrStreamingController.requestZarrJsonForMag(datasetId, dataLayerName, mag)(request))
      } yield result
    }
  }

  def requestDataLayerDirectoryContentsV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      zarrVersion: Int
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        datasetId <- remoteWebknossosClient.getDatasetId(organizationId, datasetDirectoryName)
        result <- Fox.fromFuture(
          zarrStreamingController.requestDataLayerDirectoryContents(datasetId, dataLayerName, zarrVersion)(request))
      } yield result
    }
  }

  def requestDataLayerMagDirectoryContentsV9(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mag: String,
      zarrVersion: Int
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        datasetId <- remoteWebknossosClient.getDatasetId(organizationId, datasetDirectoryName)
        result <- Fox.fromFuture(
          zarrStreamingController.requestDataLayerMagDirectoryContents(datasetId, dataLayerName, mag, zarrVersion)(
            request))
      } yield result
    }
  }

  def requestDataSourceDirectoryContentsV9(
      organizationId: String,
      datasetDirectoryName: String,
      zarrVersion: Int
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        datasetId <- remoteWebknossosClient.getDatasetId(organizationId, datasetDirectoryName)
        result <- Fox.fromFuture(
          zarrStreamingController.requestDataSourceDirectoryContents(datasetId, zarrVersion)(request))
      } yield result
    }
  }

  def requestZGroupV9(organizationId: String,
                      datasetDirectoryName: String,
                      dataLayerName: String = ""): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
        for {
          datasetId <- remoteWebknossosClient.getDatasetId(organizationId, datasetDirectoryName)
          result <- Fox.fromFuture(zarrStreamingController.requestZGroup(datasetId, dataLayerName)(request))
        } yield result
      }
    }

  // MESH ROUTES

  def loadFullMeshStl(organizationId: String,
                      datasetDirectoryName: String,
                      dataLayerName: String): Action[FullMeshRequest] =
    Action.async(validateJson[FullMeshRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
        for {
          (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                    datasetDirectoryName,
                                                                                    dataLayerName) ~> NOT_FOUND
          data: Array[Byte] <- fullMeshService.loadFor(dataSource, dataLayer, request.body) ?~> "mesh.file.loadChunk.failed"

        } yield Ok(data)
      }
    }

  // ACTIONS

  def reloadDatasourceV9(organizationId: String,
                         datasetDirectoryName: String,
                         layerName: Option[String]): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.administrateDataSources(organizationId)) {
        for {
          datasetId <- remoteWebknossosClient.getDatasetId(organizationId, datasetDirectoryName)
          result <- Fox.fromFuture(dataSourceController.reload(organizationId, datasetId, layerName)(request))
        } yield result
      }
    }
}
