package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.dataformats.zarr.{Zarr3OutputHelper, ZarrCoordinatesParser}
import com.scalableminds.webknossos.datastore.datareaders.zarr.NgffMetadataV0_5
import com.scalableminds.webknossos.datastore.datareaders.zarr3.{NgffZarr3GroupHeader, Zarr3ArrayHeader}
import com.scalableminds.webknossos.datastore.models.VoxelPosition
import com.scalableminds.webknossos.datastore.models.annotation.{AnnotationLayer, AnnotationLayerType, AnnotationSource}
import com.scalableminds.webknossos.datastore.models.datasource.*
import com.scalableminds.webknossos.datastore.models.requests.{
  Cuboid,
  DataServiceDataRequest,
  DataServiceRequestSettings
}
import com.scalableminds.webknossos.datastore.services.*
import play.api.libs.json.Json
import play.api.mvc.*

import scala.concurrent.ExecutionContext

class ZarrStreamingController @Inject() (
    datasetCache: DatasetCache,
    accessTokenService: DataStoreAccessTokenService,
    binaryDataServiceHolder: BinaryDataServiceHolder,
    remoteWebknossosClient: DSRemoteWebknossosClient,
    remoteTracingstoreClient: DSRemoteTracingstoreClient
)(implicit ec: ExecutionContext)
    extends Controller
    with Zarr3OutputHelper {

  override protected def defaultErrorCode: Int = NOT_FOUND

  val binaryDataService: BinaryDataService = binaryDataServiceHolder.binaryDataService

  override protected def allowRemoteOrigin: Boolean = true

  /** Serves the group-level zarr.json for a data layer. Embeds OME-NGFF v0.5 metadata (see
    * https://ngff.openmicroscopy.org/rfc/2/).
    */
  def requestZarrJson(
      datasetId: ObjectId,
      dataLayerName: String = ""
  ): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (dataSource, dataLayer) <- datasetCache.getWithLayer(
          datasetId,
          dataLayerName
        ) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
        omeNgffHeaderV0_5 = NgffMetadataV0_5.fromNameVoxelSizeAndMags(
          dataLayerName,
          dataSource.scale,
          dataLayer.sortedMags,
          dataLayer.additionalAxes
        )
        zarr3GroupHeader = NgffZarr3GroupHeader(3, "group", omeNgffHeaderV0_5)
      } yield Ok(Json.toJson(zarr3GroupHeader))
    }
  }

  def zarrJsonWithAnnotationPrivateLink(accessToken: String, dataLayerName: String = ""): Action[AnyContent] =
    Action.fox { implicit request =>
      ifIsAnnotationLayerOrElse(
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantTokenContext) =>
          remoteTracingstoreClient
            .getZarrJsonGroupHeaderWithNgff(annotationLayer.tracingId, annotationSource.tracingStoreUrl)(using
              relevantTokenContext
            )
            .map(header => Ok(Json.toJson(header))),
        orElse = annotationSource =>
          for {
            (dataSource, dataLayer) <- datasetCache
              .getWithLayer(annotationSource.datasetId, dataLayerName) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
            dataSourceOmeNgffHeader = NgffMetadataV0_5
              .fromNameVoxelSizeAndMags(dataLayerName, dataSource.scale, dataLayer.sortedMags, dataLayer.additionalAxes)
            zarr3GroupHeader = NgffZarr3GroupHeader(3, "group", dataSourceOmeNgffHeader)
          } yield Ok(Json.toJson(zarr3GroupHeader))
      )
    }

  /** Zarr-specific datasource-properties.json file for a datasource. Note that the result here is not necessarily equal
    * to the file used in the underlying storage.
    */
  def requestDataSource(datasetId: ObjectId): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        dataSource <- datasetCache.getById(datasetId) ~> NOT_FOUND
        dataLayers = dataSource.dataLayers
        zarrLayers = dataLayers.map(convertLayerToZarrLayer(_, zarrVersion = 3))
        zarrSource = UsableDataSource(dataSource.id, zarrLayers, dataSource.scale)
      } yield Ok(Json.toJson(zarrSource))
    }
  }

  def dataSourceWithAnnotationPrivateLink(accessToken: String): Action[AnyContent] =
    Action.fox { implicit request =>
      for {
        annotationSource <- remoteWebknossosClient.getAnnotationSource(accessToken) ~> NOT_FOUND
        relevantTokenContext =
          if (annotationSource.accessViaPrivateLink) TokenContext(Some(accessToken))
          else tokenContextForRequest
        volumeAnnotationLayers = annotationSource.annotationLayers.filter(_.typ == AnnotationLayerType.Volume)
        dataSource <- datasetCache.getById(annotationSource.datasetId) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
        dataSourceLayers = dataSource.dataLayers
          .filter(dL => !volumeAnnotationLayers.exists(_.name == dL.name))
          .map(convertLayerToZarrLayer(_, zarrVersion = 3))
        annotationLayers <- Fox.serialCombined(volumeAnnotationLayers)(l =>
          remoteTracingstoreClient.getVolumeLayerAsZarrLayer(
            l.tracingId,
            Some(l.name),
            annotationSource.tracingStoreUrl,
            zarrVersion = 3
          )(using relevantTokenContext)
        )
        allLayer = dataSourceLayers ++ annotationLayers
        zarrSource = UsableDataSource(dataSource.id, allLayer, dataSource.scale)
      } yield Ok(Json.toJson(zarrSource))
    }

  def requestRawZarrCube(
      datasetId: ObjectId,
      dataLayerName: String,
      mag: String,
      coordinates: String
  ): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      rawZarrCube(datasetId, dataLayerName, mag, coordinates)
    }
  }

  def rawZarrCubePrivateLink(
      accessToken: String,
      dataLayerName: String,
      mag: String,
      coordinates: String
  ): Action[AnyContent] =
    Action.fox { implicit request =>
      ifIsAnnotationLayerOrElse(
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantTokenContext) =>
          remoteTracingstoreClient
            .getRawZarrCube(annotationLayer.tracingId, mag, coordinates, annotationSource.tracingStoreUrl)(using
              relevantTokenContext
            )
            .map(Ok(_)),
        orElse = annotationSource => rawZarrCube(annotationSource.datasetId, dataLayerName, mag, coordinates)
      )
    }

  private def rawZarrCube(
      datasetId: ObjectId,
      dataLayerName: String,
      mag: String,
      coordinates: String
  )(using tc: TokenContext): Fox[Result] =
    for {
      (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> SERVICE_UNAVAILABLE
      reorderedAdditionalAxes = dataLayer.additionalAxes.map(reorderAdditionalAxes)
      // Failures in parsing coordinates or mag need to still be NOT_FOUND, not BAD_REQUEST because neuroglancer tries to access :layer_name/:mag/.zattrs
      (x, y, z, additionalCoordinates) <- ZarrCoordinatesParser.parseNDimensionalDotCoordinates(
        coordinates,
        reorderedAdditionalAxes
      ) ?~> Msg.Zarr.invalidChunkCoordinates(coordinates) ~> NOT_FOUND
      magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true).toFox ?~> Msg.Dataset.Mag.invalid(mag) ~> NOT_FOUND
      _ <- Fox
        .fromBool(dataLayer.containsMag(magParsed)) ?~> Msg.Dataset.Layer.magNotFound(dataLayerName, mag) ~> NOT_FOUND
      cubeSize = DataLayer.bucketLength
      request = DataServiceDataRequest(
        Some(datasetId),
        Some(dataSource.id),
        dataLayer,
        Cuboid(
          topLeft = VoxelPosition(
            x * cubeSize * magParsed.x,
            y * cubeSize * magParsed.y,
            z * cubeSize * magParsed.z,
            magParsed
          ),
          width = cubeSize,
          height = cubeSize,
          depth = cubeSize
        ),
        DataServiceRequestSettings(halfByte = false, additionalCoordinates = additionalCoordinates)
      )
      (data, emptyIndices, failureIndices) <- binaryDataService.handleDataRequests(List(request))
      _ <- Fox.fromBool(
        emptyIndices.isEmpty && failureIndices.isEmpty
      ) ?~> Msg.Zarr.chunkLoadingError ~> INTERNAL_SERVER_ERROR
    } yield Ok(data)

  def requestZarrJsonForMag(
      datasetId: ObjectId,
      dataLayerName: String,
      mag: String
  ): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      zarrJsonForMag(datasetId, dataLayerName, mag)
    }
  }

  private def zarrJsonForMag(datasetId: ObjectId, dataLayerName: String, mag: String): Fox[Result] =
    for {
      (_, dataLayer) <- datasetCache.getWithLayer(
        datasetId,
        dataLayerName
      ) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
      magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true).toFox ?~> Msg.Dataset.Mag.invalid(mag) ~> NOT_FOUND
      _ <- Fox
        .fromBool(dataLayer.containsMag(magParsed)) ?~> Msg.Dataset.Layer.magNotFound(dataLayerName, mag) ~> NOT_FOUND
      zarrHeader = Zarr3ArrayHeader.fromDataLayer(dataLayer, magParsed)
    } yield Ok(Json.toJson(zarrHeader))

  def zarrJsonPrivateLink(accessToken: String, dataLayerName: String, mag: String): Action[AnyContent] = Action.fox {
    implicit request =>
      ifIsAnnotationLayerOrElse(
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantTokenContext) =>
          remoteTracingstoreClient
            .getZarrJson(annotationLayer.tracingId, mag, annotationSource.tracingStoreUrl)(using relevantTokenContext)
            .map(z => Ok(Json.toJson(z))),
        orElse = annotationSource => zarrJsonForMag(annotationSource.datasetId, dataLayerName, mag)
      )
  }

  private def ifIsAnnotationLayerOrElse(
      accessToken: String,
      dataLayerName: String,
      ifIsAnnotationLayer: (AnnotationLayer, AnnotationSource, TokenContext) => Fox[Result],
      orElse: AnnotationSource => Fox[Result]
  )(implicit request: Request[Any]): Fox[Result] =
    for {
      annotationSource <- remoteWebknossosClient.getAnnotationSource(accessToken) ~> NOT_FOUND
      relevantTokenContext =
        if (annotationSource.accessViaPrivateLink) TokenContext(Some(accessToken))
        else tokenContextForRequest
      layer = annotationSource.getAnnotationLayer(dataLayerName)
      result <- layer match {
        case Some(annotationLayer) => ifIsAnnotationLayer(annotationLayer, annotationSource, relevantTokenContext)
        case None                  => orElse(annotationSource)
      }
    } yield result

  def requestDataLayerMagDirectoryContents(
      datasetId: ObjectId,
      dataLayerName: String,
      mag: String
  ): Action[AnyContent] =
    Action.fox { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        dataLayerMagDirectoryContents(datasetId, dataLayerName, mag)
      }
    }

  private def dataLayerMagDirectoryContents(
      datasetId: ObjectId,
      dataLayerName: String,
      mag: String
  ): Fox[Result] =
    for {
      (_, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
      magParsed <- Vec3Int.fromMagLiteral(mag, allowScalar = true).toFox ?~> Msg.Dataset.Mag.invalid(mag) ~> NOT_FOUND
      _ <- Fox
        .fromBool(dataLayer.containsMag(magParsed)) ?~> Msg.Dataset.Layer.magNotFound(dataLayerName, mag) ~> NOT_FOUND
    } yield Ok(
      views.html.datastoreZarrDatasourceDir(
        "Datastore",
        "%s/%s/%s".format(datasetId, dataLayerName, mag),
        List(Zarr3ArrayHeader.FILENAME_ZARR_JSON)
      )
    ).withHeaders()

  def dataLayerMagDirectoryContentsPrivateLink(
      accessToken: String,
      dataLayerName: String,
      mag: String
  ): Action[AnyContent] =
    Action.fox { implicit request =>
      ifIsAnnotationLayerOrElse(
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantTokenContext) =>
          remoteTracingstoreClient
            .getDataLayerMagDirectoryContents(
              annotationLayer.tracingId,
              mag,
              annotationSource.tracingStoreUrl,
              zarrVersion = 3
            )(using relevantTokenContext)
            .map(layers =>
              Ok(
                views.html.datastoreZarrDatasourceDir(
                  "Combined Annotation Route",
                  s"${annotationLayer.tracingId}",
                  layers
                )
              ).withHeaders()
            ),
        orElse = annotationSource => dataLayerMagDirectoryContents(annotationSource.datasetId, dataLayerName, mag)
      )
    }

  def requestDataLayerDirectoryContents(
      datasetId: ObjectId,
      dataLayerName: String
  ): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      dataLayerDirectoryContents(datasetId, dataLayerName)
    }
  }

  private def dataLayerDirectoryContents(datasetId: ObjectId, dataLayerName: String): Fox[Result] =
    for {
      (_, dataLayer) <- datasetCache.getWithLayer(
        datasetId,
        dataLayerName
      ) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
      mags = dataLayer.sortedMags
    } yield Ok(
      views.html.datastoreZarrDatasourceDir(
        "Datastore",
        "%s/%s".format(datasetId, dataLayerName),
        List(Zarr3ArrayHeader.FILENAME_ZARR_JSON) ++ mags.map(_.toMagLiteral(allowScalar = true))
      )
    ).withHeaders()

  def dataLayerDirectoryContentsPrivateLink(
      accessToken: String,
      dataLayerName: String
  ): Action[AnyContent] =
    Action.fox { implicit request =>
      ifIsAnnotationLayerOrElse(
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantTokenContext) =>
          remoteTracingstoreClient
            .getDataLayerDirectoryContents(annotationLayer.tracingId, annotationSource.tracingStoreUrl, zarrVersion = 3)(
              using relevantTokenContext
            )
            .map(layers =>
              Ok(
                views.html.datastoreZarrDatasourceDir(
                  "Tracingstore",
                  s"${annotationLayer.tracingId}",
                  layers
                )
              ).withHeaders()
            ),
        orElse = annotationSource => dataLayerDirectoryContents(annotationSource.datasetId, dataLayerName)
      )
    }

  def requestDataSourceDirectoryContents(datasetId: ObjectId): Action[AnyContent] =
    Action.fox { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          dataSource <- datasetCache.getById(datasetId) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
          layerNames = dataSource.dataLayers.map((dataLayer: DataLayer) => dataLayer.name)
        } yield Ok(
          views.html.datastoreZarrDatasourceDir(
            "Datastore",
            s"$datasetId",
            List(UsableDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON) ++ layerNames
          )
        )
      }
    }

  def dataSourceDirectoryContentsPrivateLink(accessToken: String): Action[AnyContent] =
    Action.fox { implicit request =>
      for {
        annotationSource <- remoteWebknossosClient.getAnnotationSource(accessToken)
        dataSource <- datasetCache.getById(annotationSource.datasetId) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
        annotationLayerNames = annotationSource.annotationLayers.filter(_.typ == AnnotationLayerType.Volume).map(_.name)
        dataSourceLayerNames = dataSource.dataLayers
          .map((dataLayer: DataLayer) => dataLayer.name)
          .filter(!annotationLayerNames.contains(_))
        layerNames = annotationLayerNames ++ dataSourceLayerNames
      } yield Ok(
        views.html.datastoreZarrDatasourceDir(
          "Combined datastore and tracingstore directory",
          s"$accessToken",
          List(UsableDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON) ++ layerNames
        )
      )
    }

  /** zarr3_experimental is deprecated: /zarr now defaults to Zarr v3. Redirect old dataset-scoped URLs to their
    * new home, preserving the query string (private-link tokens can travel as ?token=...).
    */
  def redirectZarr3(datasetId: ObjectId, rest: String): Action[AnyContent] = Action { implicit request =>
    val suffix = if (rest.isEmpty) "" else s"/$rest"
    Redirect(s"/zarr/$datasetId$suffix", request.queryString, MOVED_PERMANENTLY)
  }

  def redirectAnnotationZarr3(accessTokenOrId: String, rest: String): Action[AnyContent] = Action { implicit request =>
    val suffix = if (rest.isEmpty) "" else s"/$rest"
    Redirect(s"/annotations/zarr/$accessTokenOrId$suffix", request.queryString, MOVED_PERMANENTLY)
  }
}
