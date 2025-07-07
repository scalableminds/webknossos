package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.webknossos.datastore.dataformats.zarr.Zarr3OutputHelper
import com.scalableminds.webknossos.datastore.models.datasource.{DataSourceId, GenericDataSource}
import com.scalableminds.webknossos.datastore.services.{
  BinaryDataServiceHolder,
  DSRemoteTracingstoreClient,
  DSRemoteWebknossosClient,
  DataSourceRepository,
  DataStoreAccessTokenService,
  UserAccessRequest,
  ZarrStreamingService
}
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent}

import scala.concurrent.ExecutionContext

class LegacyController @Inject()(
    dataSourceRepository: DataSourceRepository,
    accessTokenService: DataStoreAccessTokenService,
    binaryDataServiceHolder: BinaryDataServiceHolder,
    remoteWebknossosClient: DSRemoteWebknossosClient,
    remoteTracingstoreClient: DSRemoteTracingstoreClient,
    zarrStreamingService: ZarrStreamingService
)(implicit ec: ExecutionContext)
    extends Controller
    with Zarr3OutputHelper {

  /**
    * Serve .zattrs file for a dataset
    * Uses the OME-NGFF standard (see https://ngff.openmicroscopy.org/latest/)
    */
  def requestZAttrs(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String = "",
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        dataSource <- dataSourceRepository
          .findUsable(DataSourceId(datasetDirectoryName, organizationId))
          .toFox ~> NOT_FOUND
        dataLayer <- dataSource.getDataLayer(dataLayerName).toFox ~> NOT_FOUND
        header = zarrStreamingService.getHeader(dataSource, dataLayer)
      } yield Ok(Json.toJson(header))
    }
  }

  def requestZarrJson(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String = "",
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        dataSource <- dataSourceRepository
          .findUsable(DataSourceId(datasetDirectoryName, organizationId))
          .toFox ~> NOT_FOUND
        dataLayer <- dataSource.getDataLayer(dataLayerName).toFox ~> NOT_FOUND
        header = zarrStreamingService.getGroupHeader(dataSource, dataLayer)
      } yield Ok(Json.toJson(header))
    }
  }

  /**
    * Zarr-specific datasource-properties.json file for a datasource.
    * Note that the result here is not necessarily equal to the file used in the underlying storage.
    */
  def requestDataSource(
      organizationId: String,
      datasetDirectoryName: String,
      zarrVersion: Int,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        dataSource <- dataSourceRepository
          .findUsable(DataSourceId(datasetDirectoryName, organizationId))
          .toFox ~> NOT_FOUND
        zarrSource = zarrStreamingService.getZarrDataSource(dataSource, zarrVersion)
      } yield Ok(Json.toJson(zarrSource))
    }
  }

  def requestRawZarrCube(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mag: String,
      coordinates: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                  datasetDirectoryName,
                                                                                  dataLayerName) ~> NOT_FOUND
        result <- zarrStreamingService.rawZarrCube(dataSource, dataLayer, mag, coordinates)
      } yield Ok(result)
    }
  }

  def requestZArray(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mag: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                  datasetDirectoryName,
                                                                                  dataLayerName) ~> NOT_FOUND
        zarrHeader <- zarrStreamingService.getZArray(dataLayer, mag)
      } yield Ok(Json.toJson(zarrHeader))
    }
  }

  def requestZarrJsonForMag(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mag: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                  datasetDirectoryName,
                                                                                  dataLayerName)
        zarrJson <- zarrStreamingService.requestZarrJsonForMag(dataSource, dataLayer, mag)
      } yield Ok(Json.toJson(zarrJson))
    }
  }

  def requestDataLayerDirectoryContents(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      zarrVersion: Int
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                  datasetDirectoryName,
                                                                                  dataLayerName) ~> NOT_FOUND
        contents <- zarrStreamingService.dataLayerDirectoryContents(dataSource, dataLayer, zarrVersion)
      } yield
        Ok(
          views.html.datastoreZarrDatasourceDir(
            "Datastore",
            "%s/%s/%s".format(organizationId, datasetDirectoryName, dataLayerName),
            contents
          )).withHeaders()

    }
  }

  def requestDataLayerMagDirectoryContents(
      organizationId: String,
      datasetDirectoryName: String,
      dataLayerName: String,
      mag: String,
      zarrVersion: Int
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationId,
                                                                                  datasetDirectoryName,
                                                                                  dataLayerName) ~> NOT_FOUND
        contents <- zarrStreamingService.dataLayerMagDirectoryContents(dataSource, dataLayer, mag, zarrVersion)
      } yield
        Ok(
          views.html.datastoreZarrDatasourceDir(
            "Datastore",
            "%s/%s/%s/%s".format(organizationId, datasetDirectoryName, dataLayerName, mag),
            contents
          )).withHeaders()
    }
  }

  def requestDataSourceDirectoryContents(
      organizationId: String,
      datasetDirectoryName: String,
      zarrVersion: Int
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(
      UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
      for {
        dataSource <- dataSourceRepository
          .findUsable(DataSourceId(datasetDirectoryName, organizationId))
          .toFox ~> NOT_FOUND
        files <- zarrStreamingService.dataSourceDirectoryContents(dataSource, zarrVersion)
      } yield
        Ok(
          views.html.datastoreZarrDatasourceDir(
            "Datastore",
            s"$organizationId/$datasetDirectoryName",
            List(GenericDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON) ++ files
          ))
    }
  }

  def requestZGroup(organizationId: String,
                    datasetDirectoryName: String,
                    dataLayerName: String = ""): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContextForSyncBlock(
        UserAccessRequest.readDataSources(DataSourceId(datasetDirectoryName, organizationId))) {
        Ok(zarrStreamingService.zGroupJson)
      }
    }

}
