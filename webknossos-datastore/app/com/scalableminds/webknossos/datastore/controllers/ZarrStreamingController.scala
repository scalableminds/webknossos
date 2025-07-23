package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.layers.{ZarrDataLayer, ZarrLayer, ZarrSegmentationLayer}
import com.scalableminds.webknossos.datastore.dataformats.zarr.Zarr3OutputHelper
import com.scalableminds.webknossos.datastore.datareaders.zarr.{NgffMetadata, NgffMetadataV0_5}
import com.scalableminds.webknossos.datastore.datareaders.zarr3.NgffZarr3GroupHeader
import com.scalableminds.webknossos.datastore.models.annotation.{AnnotationLayer, AnnotationLayerType, AnnotationSource}
import com.scalableminds.webknossos.datastore.models.datasource._
import com.scalableminds.webknossos.datastore.services._
import play.api.i18n.Messages
import play.api.libs.json.Json
import play.api.mvc._

import scala.concurrent.ExecutionContext
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder

class ZarrStreamingController @Inject()(
    datasetCache: DatasetCache,
    accessTokenService: DataStoreAccessTokenService,
    binaryDataServiceHolder: BinaryDataServiceHolder,
    remoteWebknossosClient: DSRemoteWebknossosClient,
    remoteTracingstoreClient: DSRemoteTracingstoreClient,
    zarrStreamingService: ZarrStreamingService
)(implicit ec: ExecutionContext)
    extends Controller
    with Zarr3OutputHelper {

  override def defaultErrorCode: Int = NOT_FOUND

  val binaryDataService: BinaryDataService = binaryDataServiceHolder.binaryDataService

  override def allowRemoteOrigin: Boolean = true

  /**
    * Serve .zattrs file for a dataset
    * Uses the OME-NGFF standard (see https://ngff.openmicroscopy.org/latest/)
    */
  def requestZAttrs(
      datasetId: ObjectId,
      dataLayerName: String = "",
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
        header = zarrStreamingService.getHeader(dataSource, dataLayer)
      } yield Ok(Json.toJson(header))
    }
  }

  def requestZarrJson(
      datasetId: ObjectId,
      dataLayerName: String = "",
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
        header = zarrStreamingService.getGroupHeader(dataSource, dataLayer)
      } yield Ok(Json.toJson(header))
    }
  }

  def zAttrsWithAnnotationPrivateLink(accessToken: String, dataLayerName: String = ""): Action[AnyContent] =
    Action.async { implicit request =>
      ifIsAnnotationLayerOrElse(
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantTokenContext) => {
          remoteTracingstoreClient
            .getOmeNgffHeader(annotationLayer.tracingId, annotationSource.tracingStoreUrl)(relevantTokenContext)
            .map(ngffMetadata => Ok(Json.toJson(ngffMetadata)))
        },
        orElse = annotationSource =>
          for {
            (dataSource, dataLayer) <- datasetCache
              .getWithLayer(annotationSource.datasetId, dataLayerName) ?~> Messages("dataSource.notFound") ~> NOT_FOUND
            dataSourceOmeNgffHeader = NgffMetadata.fromNameVoxelSizeAndMags(dataLayerName,
                                                                            dataSource.scale,
                                                                            dataLayer.sortedMags)
          } yield Ok(Json.toJson(dataSourceOmeNgffHeader))
      )
    }

  def zarrJsonWithAnnotationPrivateLink(accessToken: String, dataLayerName: String = ""): Action[AnyContent] =
    Action.async { implicit request =>
      ifIsAnnotationLayerOrElse(
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantTokenContext) => {
          remoteTracingstoreClient
            .getZarrJsonGroupHeaderWithNgff(annotationLayer.tracingId, annotationSource.tracingStoreUrl)(
              relevantTokenContext)
            .map(header => Ok(Json.toJson(header)))
        },
        orElse = annotationSource =>
          for {
            (dataSource, dataLayer) <- datasetCache
              .getWithLayer(annotationSource.datasetId, dataLayerName) ?~> Messages("dataSource.notFound") ~> NOT_FOUND
            dataSourceOmeNgffHeader = NgffMetadataV0_5.fromNameVoxelSizeAndMags(dataLayerName,
                                                                                dataSource.scale,
                                                                                dataLayer.sortedMags,
                                                                                dataLayer.additionalAxes)
            zarr3GroupHeader = NgffZarr3GroupHeader(3, "group", dataSourceOmeNgffHeader)
          } yield Ok(Json.toJson(zarr3GroupHeader))
      )
    }

  /**
    * Zarr-specific datasource-properties.json file for a datasource.
    * Note that the result here is not necessarily equal to the file used in the underlying storage.
    */
  def requestDataSource(
      datasetId: ObjectId,
      zarrVersion: Int,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        dataSource <- datasetCache.getById(datasetId) ~> NOT_FOUND
        zarrSource = zarrStreamingService.getZarrDataSource(dataSource, zarrVersion)
      } yield Ok(Json.toJson(zarrSource))
    }
  }

  private def convertLayerToZarrLayer(layer: DataLayer, zarrVersion: Int): ZarrLayer = {
    val dataFormat = if (zarrVersion == 2) DataFormat.zarr else DataFormat.zarr3
    layer match {
      case s: SegmentationLayer =>
        val rank = s.additionalAxes.map(_.length).getOrElse(0) + 4 // We’re writing c, additionalAxes, xyz
        ZarrSegmentationLayer(
          s.name,
          s.boundingBox,
          s.elementClass,
          mags = s.sortedMags.map(
            m =>
              MagLocator(m,
                         Some(s"./${s.name}/${m.toMagLiteral(allowScalar = true)}"),
                         None,
                         Some(AxisOrder.cAdditionalxyz(rank)),
                         None,
                         None)),
          mappings = s.mappings,
          largestSegmentId = s.largestSegmentId,
          numChannels = Some(if (s.elementClass == ElementClass.uint24) 3 else 1),
          defaultViewConfiguration = s.defaultViewConfiguration,
          adminViewConfiguration = s.adminViewConfiguration,
          coordinateTransformations = s.coordinateTransformations,
          additionalAxes = s.additionalAxes.map(reorderAdditionalAxes),
          dataFormat = dataFormat
        )
      case d: DataLayer =>
        val rank = d.additionalAxes.map(_.length).getOrElse(0) + 4 // We’re writing c, additionalAxes, xyz
        ZarrDataLayer(
          d.name,
          d.category,
          d.boundingBox,
          d.elementClass,
          mags = d.sortedMags.map(
            m =>
              MagLocator(m,
                         Some(s"./${d.name}/${m.toMagLiteral(allowScalar = true)}"),
                         None,
                         Some(AxisOrder.cAdditionalxyz(rank)),
                         None,
                         None)),
          numChannels = Some(if (d.elementClass == ElementClass.uint24) 3 else 1),
          defaultViewConfiguration = d.defaultViewConfiguration,
          adminViewConfiguration = d.adminViewConfiguration,
          coordinateTransformations = d.coordinateTransformations,
          additionalAxes = d.additionalAxes.map(reorderAdditionalAxes),
          dataFormat = dataFormat
        )
    }
  }

  def dataSourceWithAnnotationPrivateLink(accessToken: String, zarrVersion: Int): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        annotationSource <- remoteWebknossosClient.getAnnotationSource(accessToken) ~> NOT_FOUND
        relevantTokenContext = if (annotationSource.accessViaPrivateLink) TokenContext(Some(accessToken))
        else tokenContextForRequest
        volumeAnnotationLayers = annotationSource.annotationLayers.filter(_.typ == AnnotationLayerType.Volume)
        dataSource <- datasetCache.getById(annotationSource.datasetId) ?~> Messages("dataSource.notFound") ~> NOT_FOUND
        dataSourceLayers = dataSource.dataLayers
          .filter(dL => !volumeAnnotationLayers.exists(_.name == dL.name))
          .map(convertLayerToZarrLayer(_, zarrVersion))
        annotationLayers <- Fox.serialCombined(volumeAnnotationLayers)(
          l =>
            remoteTracingstoreClient.getVolumeLayerAsZarrLayer(l.tracingId,
                                                               Some(l.name),
                                                               annotationSource.tracingStoreUrl,
                                                               zarrVersion)(relevantTokenContext))
        allLayer = dataSourceLayers ++ annotationLayers
        zarrSource = GenericDataSource[DataLayer](dataSource.id, allLayer, dataSource.scale)
      } yield Ok(Json.toJson(zarrSource))
    }

  def requestRawZarrCube(
      datasetId: ObjectId,
      dataLayerName: String,
      mag: String,
      coordinates: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
        result <- zarrStreamingService.rawZarrCube(dataSource, dataLayer, mag, coordinates)
      } yield Ok(result)
    }
  }

  def rawZarrCubePrivateLink(accessToken: String,
                             dataLayerName: String,
                             mag: String,
                             coordinates: String): Action[AnyContent] =
    Action.async { implicit request =>
      ifIsAnnotationLayerOrElse(
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantTokenContext) =>
          remoteTracingstoreClient
            .getRawZarrCube(annotationLayer.tracingId, mag, coordinates, annotationSource.tracingStoreUrl)(
              relevantTokenContext)
            .map(Ok(_)),
        orElse = annotationSource =>
          for {
            (dataSource, dataLayer) <- datasetCache
              .getWithLayer(annotationSource.datasetId, dataLayerName) ?~> Messages("dataSource.notFound") ~> NOT_FOUND
            zarrCube <- zarrStreamingService.rawZarrCube(dataSource, dataLayer, mag, coordinates)
          } yield Ok(zarrCube)
      )
    }

  def requestZArray(
      datasetId: ObjectId,
      dataLayerName: String,
      mag: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (_, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
        zarrHeader <- zarrStreamingService.getZArray(dataLayer, mag)
      } yield Ok(Json.toJson(zarrHeader))
    }
  }

  def requestZarrJsonForMag(
      datasetId: ObjectId,
      dataLayerName: String,
      mag: String,
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
        zarrJson <- zarrStreamingService.requestZarrJsonForMag(dataSource, dataLayer, mag)
      } yield Ok(Json.toJson(zarrJson))
    }
  }

  def zArrayPrivateLink(accessToken: String, dataLayerName: String, mag: String): Action[AnyContent] = Action.async {
    implicit request =>
      ifIsAnnotationLayerOrElse(
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantTokenContext) =>
          remoteTracingstoreClient
            .getZArray(annotationLayer.tracingId, mag, annotationSource.tracingStoreUrl)(relevantTokenContext)
            .map(z => Ok(Json.toJson(z))),
        orElse = annotationSource =>
          for {
            (_, dataLayer) <- datasetCache.getWithLayer(annotationSource.datasetId, dataLayerName) ?~> Messages(
              "dataSource.notFound") ~> NOT_FOUND
            zArray <- zarrStreamingService.getZArray(dataLayer, mag)
          } yield Ok(Json.toJson(zArray))
      )
  }

  def zarrJsonPrivateLink(accessToken: String, dataLayerName: String, mag: String): Action[AnyContent] = Action.async {
    implicit request =>
      ifIsAnnotationLayerOrElse(
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantTokenContext) =>
          remoteTracingstoreClient
            .getZarrJson(annotationLayer.tracingId, mag, annotationSource.tracingStoreUrl)(relevantTokenContext)
            .map(z => Ok(Json.toJson(z))),
        orElse = annotationSource =>
          for {
            (dataSource, dataLayer) <- datasetCache
              .getWithLayer(annotationSource.datasetId, dataLayerName) ?~> Messages("dataSource.notFound") ~> NOT_FOUND
            zarrJson <- zarrStreamingService.requestZarrJsonForMag(dataSource, dataLayer, mag)
          } yield Ok(Json.toJson(zarrJson))
      )
  }

  private def ifIsAnnotationLayerOrElse(
      accessToken: String,
      dataLayerName: String,
      ifIsAnnotationLayer: (AnnotationLayer, AnnotationSource, TokenContext) => Fox[Result],
      orElse: AnnotationSource => Fox[Result])(implicit request: Request[Any]): Fox[Result] =
    for {
      annotationSource <- remoteWebknossosClient.getAnnotationSource(accessToken) ~> NOT_FOUND
      relevantTokenContext = if (annotationSource.accessViaPrivateLink) TokenContext(Some(accessToken))
      else tokenContextForRequest
      layer = annotationSource.getAnnotationLayer(dataLayerName)
      result <- layer match {
        case Some(annotationLayer) => ifIsAnnotationLayer(annotationLayer, annotationSource, relevantTokenContext)
        case None                  => orElse(annotationSource)
      }
    } yield result

  def requestDataLayerDirectoryContents(
      datasetId: ObjectId,
      dataLayerName: String,
      zarrVersion: Int
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
        contents <- zarrStreamingService.dataLayerDirectoryContents(dataSource, dataLayer, zarrVersion)
      } yield
        Ok(
          views.html.datastoreZarrDatasourceDir(
            "Datastore",
            "%s/%s".format(datasetId, dataLayerName),
            contents
          )).withHeaders()

    }
  }

  def dataLayerDirectoryContentsPrivateLink(accessToken: String,
                                            dataLayerName: String,
                                            zarrVersion: Int): Action[AnyContent] =
    Action.async { implicit request =>
      ifIsAnnotationLayerOrElse(
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantTokenContext) =>
          remoteTracingstoreClient
            .getDataLayerDirectoryContents(annotationLayer.tracingId, annotationSource.tracingStoreUrl, zarrVersion)(
              relevantTokenContext)
            .map(
              layers =>
                Ok(
                  views.html.datastoreZarrDatasourceDir(
                    "Tracingstore",
                    s"${annotationLayer.tracingId}",
                    layers
                  )).withHeaders()),
        orElse = annotationSource =>
          for {
            (dataSource, dataLayer) <- datasetCache
              .getWithLayer(annotationSource.datasetId, dataLayerName) ?~> Messages("dataSource.notFound") ~> NOT_FOUND
            content <- zarrStreamingService.dataLayerDirectoryContents(dataSource, dataLayer, zarrVersion)
          } yield Ok(Json.toJson(content))
      )
    }

  def requestDataLayerMagDirectoryContents(
      datasetId: ObjectId,
      dataLayerName: String,
      mag: String,
      zarrVersion: Int
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
        contents <- zarrStreamingService.dataLayerMagDirectoryContents(dataSource, dataLayer, mag, zarrVersion)
      } yield
        Ok(
          views.html.datastoreZarrDatasourceDir(
            "Datastore",
            "%s/%s/%s".format(datasetId, dataLayerName, mag),
            contents
          )).withHeaders()
    }
  }

  def dataLayerMagDirectoryContentsPrivateLink(accessToken: String,
                                               dataLayerName: String,
                                               mag: String,
                                               zarrVersion: Int): Action[AnyContent] =
    Action.async { implicit request =>
      ifIsAnnotationLayerOrElse(
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantTokenContext) =>
          remoteTracingstoreClient
            .getDataLayerMagDirectoryContents(annotationLayer.tracingId,
                                              mag,
                                              annotationSource.tracingStoreUrl,
                                              zarrVersion)(relevantTokenContext)
            .map(
              layers =>
                Ok(
                  views.html.datastoreZarrDatasourceDir(
                    "Combined Annotation Route",
                    s"${annotationLayer.tracingId}",
                    layers
                  )).withHeaders()),
        orElse = annotationSource =>
          for {
            (dataSource, dataLayer) <- datasetCache
              .getWithLayer(annotationSource.datasetId, dataLayerName) ?~> Messages("dataSource.notFound") ~> NOT_FOUND
            contents <- zarrStreamingService.dataLayerMagDirectoryContents(dataSource, dataLayer, mag, zarrVersion)
          } yield Ok(Json.toJson(contents))
      )
    }

  def requestDataSourceDirectoryContents(
      datasetId: ObjectId,
      zarrVersion: Int
  ): Action[AnyContent] = Action.async { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        dataSource <- datasetCache.getById(datasetId)
        files <- zarrStreamingService.dataSourceDirectoryContents(dataSource, zarrVersion)
      } yield
        Ok(
          views.html.datastoreZarrDatasourceDir(
            "Datastore",
            datasetId.toString,
            List(GenericDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON) ++ files
          ))
    }
  }

  def dataSourceDirectoryContentsPrivateLink(accessToken: String, zarrVersion: Int): Action[AnyContent] =
    Action.async { implicit request =>
      for {
        contents <- zarrStreamingService.dataSourceDirectoryContentsPrivateLink(accessToken, zarrVersion)
      } yield
        Ok(
          views.html.datastoreZarrDatasourceDir(
            "Combined datastore and tracingstore directory",
            s"$accessToken",
            contents
          ))
    }

  def requestZGroup(datasetId: ObjectId, dataLayerName: String = ""): Action[AnyContent] =
    Action.async { implicit request =>
      accessTokenService.validateAccessFromTokenContextForSyncBlock(UserAccessRequest.readDataset(datasetId)) {
        Ok(zarrStreamingService.zGroupJson)
      }
    }

  def zGroupPrivateLink(accessToken: String, dataLayerName: String): Action[AnyContent] =
    Action.async { implicit request =>
      ifIsAnnotationLayerOrElse(
        accessToken,
        dataLayerName,
        ifIsAnnotationLayer = (annotationLayer, annotationSource, relevantTokenContext) =>
          remoteTracingstoreClient
            .getZGroup(annotationLayer.tracingId, annotationSource.tracingStoreUrl)(relevantTokenContext)
            .map(Ok(_)),
        orElse = _ => Fox.successful(Ok(zarrStreamingService.zGroupJson))
      )
    }
}
