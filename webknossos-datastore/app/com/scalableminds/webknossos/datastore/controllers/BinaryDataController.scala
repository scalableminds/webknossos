package com.scalableminds.webknossos.datastore.controllers

import java.io.{ByteArrayOutputStream, OutputStream}
import java.util.Base64

import akka.stream.scaladsl.StreamConverters
import com.google.inject.Inject
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.webknossos.datastore.services.{AccessTokenService, BinaryDataService, DataSourceRepository, UserAccessRequest}
import com.scalableminds.webknossos.datastore.models._
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSource, SegmentationLayer}
import com.scalableminds.webknossos.datastore.models.requests.{DataServiceDataRequest, DataServiceMappingRequest, DataServiceRequestSettings}
import com.scalableminds.webknossos.datastore.models.DataRequestCollection._
import com.scalableminds.webknossos.datastore.models.{DataRequest, ImageThumbnail, WebKnossosDataRequest}
import com.scalableminds.webknossos.datastore.tracings.volume.VolumeTracingService
import com.scalableminds.util.image.{ImageCreator, ImageCreatorParameters, JPEGWriter}
import com.scalableminds.util.tools.Fox
import net.liftweb.util.Helpers.tryo
import play.api.http.HttpEntity
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.iteratee.Enumerator
import play.api.libs.json.Json
import play.api.mvc.{ResponseHeader, Result}

class BinaryDataController @Inject()(
                                      binaryDataService: BinaryDataService,
                                      dataSourceRepository: DataSourceRepository,
                                      volumeTracingService: VolumeTracingService,
                                      val accessTokenService: AccessTokenService,
                                      val messagesApi: MessagesApi
                                    ) extends TokenSecuredController {

  /**
    * Handles requests for raw binary data via HTTP POST from webKnossos.
    */
  def requestViaWebKnossos(
                            dataSetName: String,
                            dataLayerName: String
                          ) = TokenSecuredAction(UserAccessRequest.readDataSources(dataSetName)).async(validateJson[List[WebKnossosDataRequest]]) {
    implicit request =>
      AllowRemoteOrigin {
        for {
          (dataSource, dataLayer) <- getDataSourceAndDataLayer(dataSetName, dataLayerName)
          data <- requestData(dataSource, dataLayer, request.body)
        } yield Ok(data)
      }
  }

  /**
    * Handles requests for raw binary data via HTTP GET.
    */
  def requestRawCuboid(
                           dataSetName: String,
                           dataLayerName: String,
                           x: Int,
                           y: Int,
                           z: Int,
                           width: Int,
                           height: Int,
                           depth: Int,
                           resolution: Int,
                           halfByte: Boolean
                         ) = TokenSecuredAction(UserAccessRequest.readDataSources(dataSetName)).async {
    implicit request =>
      AllowRemoteOrigin {
        for {
          (dataSource, dataLayer) <- getDataSourceAndDataLayer(dataSetName, dataLayerName)
          request = DataRequest(
            new VoxelPosition(x, y, z, dataLayer.lookUpResolution(resolution)),
            width,
            height,
            depth,
            DataServiceRequestSettings(halfByte = halfByte)
          )
        data <- requestData(dataSource, dataLayer, request).map(Ok(_))
        } yield data
      }
  }

  /**
    * Handles requests for raw binary data via HTTP GET for debugging.
    */
  def requestViaAjaxDebug(
                           dataSetName: String,
                           dataLayerName: String,
                           cubeSize: Int,
                           x: Int,
                           y: Int,
                           z: Int,
                           resolution: Int,
                           halfByte: Boolean
                         ) =
    requestRawCuboid(dataSetName, dataLayerName, x, y, z, cubeSize, cubeSize, cubeSize, resolution, halfByte)

  /**
    * Handles a request for raw binary data via a HTTP GET. Used by knossos.
    */
  def requestViaKnossos(
                         dataSetName: String,
                         dataLayerName: String,
                         resolution: Int,
                         x: Int, y: Int, z: Int,
                         cubeSize: Int
                       ) = TokenSecuredAction(UserAccessRequest.readDataSources(dataSetName)).async {
    implicit request =>
      AllowRemoteOrigin {
        for {
          (dataSource, dataLayer) <- getDataSourceAndDataLayer(dataSetName, dataLayerName)
          request = DataRequest(
                        new VoxelPosition(x * cubeSize * resolution,
                          y * cubeSize * resolution,
                          z * cubeSize * resolution,
                          Point3D(resolution, resolution, resolution)),
          cubeSize,
          cubeSize,
          cubeSize)
          data <- requestData(dataSource, dataLayer, request).map(Ok(_))
        } yield data
      }
  }

  /**
    * Handles requests for data sprite sheets.
    */
  def requestSpriteSheet(
                          dataSetName: String,
                          dataLayerName: String,
                          cubeSize: Int,
                          imagesPerRow: Int,
                          x: Int,
                          y: Int,
                          z: Int,
                          resolution: Int,
                          halfByte: Boolean
                        ) = TokenSecuredAction(UserAccessRequest.readDataSources(dataSetName)).async(parse.raw) {
    implicit request =>
      AllowRemoteOrigin {
        for {
          (dataSource, dataLayer) <- getDataSourceAndDataLayer(dataSetName, dataLayerName)
          request = DataRequest(
            new VoxelPosition(x, y, z, dataLayer.lookUpResolution(resolution)),
            cubeSize,
            cubeSize,
            cubeSize,
            DataServiceRequestSettings(halfByte = halfByte))
          imageProvider <- respondWithSpriteSheet(dataSource, dataLayer, request, imagesPerRow, blackAndWhite = false)
        } yield {
          Result(
            header = ResponseHeader(200),
            body = HttpEntity.Streamed(StreamConverters.asOutputStream().mapMaterializedValue { outputStream => imageProvider(outputStream) }, None, Some(contentTypeJpeg)))
        }
      }
  }

  /**
    * Handles requests for data images.
    */
  def requestImage(
                    dataSetName: String,
                    dataLayerName: String,
                    width: Int,
                    height: Int,
                    x: Int,
                    y: Int,
                    z: Int,
                    resolution: Int,
                    halfByte: Boolean,
                    blackAndWhite: Boolean) = TokenSecuredAction(UserAccessRequest.readDataSources(dataSetName)).async(parse.raw) {
    implicit request =>
      AllowRemoteOrigin {
        for {
          (dataSource, dataLayer) <- getDataSourceAndDataLayer(dataSetName, dataLayerName)
          request = DataRequest(
            new VoxelPosition(x, y, z, dataLayer.lookUpResolution(resolution)),
            width,
            height,
            1,
            DataServiceRequestSettings(halfByte = halfByte))
          imageProvider <- respondWithSpriteSheet(dataSource, dataLayer, request, 1, blackAndWhite)
        } yield {
          Result(
            header = ResponseHeader(200),
            body = HttpEntity.Streamed(StreamConverters.asOutputStream().mapMaterializedValue { outputStream => imageProvider(outputStream) }, None, Some(contentTypeJpeg)))
        }
      }
  }

  /**
    * Handles requests for dataset thumbnail images as JPEG.
    */
  def requestImageThumbnailJpeg(
                                 dataSetName: String,
                                 dataLayerName: String,
                                 width: Int,
                                 height: Int,
                                 centerX: Option[Int],
                                 centerY: Option[Int],
                                 centerZ: Option[Int],
                                 zoom: Option[Int]) = TokenSecuredAction(UserAccessRequest.readDataSources(dataSetName)).async(parse.raw) {
    implicit request =>
      AllowRemoteOrigin {
        for {
          thumbnailProvider <- respondWithImageThumbnail(dataSetName, dataLayerName, width, height, centerX, centerY, centerZ, zoom)
        } yield {
          Result(
            header = ResponseHeader(200),
            body = HttpEntity.Streamed(StreamConverters.asOutputStream().mapMaterializedValue { outputStream => thumbnailProvider(outputStream) }, None, Some(contentTypeJpeg)))
        }
      }
  }

  /**
    * Handles requests for dataset thumbnail images as base64-encoded JSON.
    */
  def requestImageThumbnailJson(
                                 dataSetName: String,
                                 dataLayerName: String,
                                 width: Int,
                                 height: Int,
                                 centerX: Option[Int],
                                 centerY: Option[Int],
                                 centerZ: Option[Int],
                                 zoom: Option[Int]
                               ) = TokenSecuredAction(UserAccessRequest.readDataSources(dataSetName)).async(parse.raw) {
    implicit request =>
      AllowRemoteOrigin {
        for {
          thumbnailProvider <- respondWithImageThumbnail(dataSetName, dataLayerName, width, height, centerX, centerY, centerZ, zoom)
        } yield {
          val os = new ByteArrayOutputStream()
          thumbnailProvider(Base64.getEncoder.wrap(os))
          Ok(Json.toJson(ImageThumbnail(contentTypeJpeg, os.toString)))
        }
      }
  }

  /**
    * Handles mapping requests.
    */
  def requestMapping(
                      dataSetName: String,
                      dataLayerName: String,
                      mappingName: String
                    ) = TokenSecuredAction(UserAccessRequest.readDataSources(dataSetName)).async {
    implicit request =>
      AllowRemoteOrigin {
        for {
          (dataSource, dataLayer) <- getDataSourceAndDataLayer(dataSetName, dataLayerName)
          segmentationLayer <- tryo(dataLayer.asInstanceOf[SegmentationLayer]).toFox ?~> Messages("dataLayer.notFound")
          mappingRequest = DataServiceMappingRequest(dataSource, segmentationLayer, mappingName)
          result <- binaryDataService.handleMappingRequest(mappingRequest)
        } yield {
          Ok(result)
        }
      }
  }

  private def getDataLayer(dataSource: DataSource, dataLayerName: String): Fox[DataLayer] = {
    dataSource.getDataLayer(dataLayerName).toFox.orElse(
      volumeTracingService.dataLayerForVolumeTracing(dataLayerName, dataSource))
  }

  private def getDataSourceAndDataLayer(dataSetName: String, dataLayerName: String): Fox[(DataSource, DataLayer)] = {
    for {
      dataSource <- dataSourceRepository.findUsableByName(dataSetName).toFox ?~> Messages("dataSource.notFound") ~> 404
      dataLayer <- getDataLayer(dataSource, dataLayerName) ?~> Messages("dataLayer.notFound", dataLayerName) ~> 404
    } yield {
      (dataSource, dataLayer)
    }
  }

  private def requestData(
                           dataSource: DataSource,
                           dataLayer: DataLayer,
                           dataRequests: DataRequestCollection
                         ): Fox[Array[Byte]] = {
    val requests = dataRequests.map(r => DataServiceDataRequest(dataSource, dataLayer, r.cuboid(dataLayer), r.settings))
    binaryDataService.handleDataRequests(requests)
  }

  private def contentTypeJpeg = play.api.libs.MimeTypes.forExtension("jpeg").getOrElse(play.api.http.ContentTypes.BINARY)

  private def respondWithSpriteSheet(
                                      dataSource: DataSource,
                                      dataLayer: DataLayer,
                                      request: DataRequest,
                                      imagesPerRow: Int,
                                      blackAndWhite: Boolean
                                    ): Fox[(OutputStream) => Unit] = {
    val params = ImageCreatorParameters(
      dataLayer.bytesPerElement,
      request.settings.halfByte,
      request.cuboid(dataLayer).width,
      request.cuboid(dataLayer).height,
      imagesPerRow,
      blackAndWhite = blackAndWhite)
    for {
      data <- requestData(dataSource, dataLayer, request)
      spriteSheet <- ImageCreator.spriteSheetFor(data, params) ?~> Messages("image.create.failed")
      firstSheet <- spriteSheet.pages.headOption ?~> Messages("image.page.failed")
    } yield {
      new JPEGWriter().writeToOutputStream(firstSheet.image)
    }
  }

  private def respondWithImageThumbnail(
                                     dataSetName: String,
                                     dataLayerName: String,
                                     width: Int,
                                     height: Int,
                                     centerX: Option[Int],
                                     centerY: Option[Int],
                                     centerZ: Option[Int],
                                     zoom: Option[Int]
                                   ): Fox[(OutputStream) => Unit] = {
    for {
      (dataSource, dataLayer) <- getDataSourceAndDataLayer(dataSetName, dataLayerName)
      position = ImageThumbnail.goodThumbnailParameters(dataLayer, width, height, centerX, centerY, centerZ, zoom)
      request = DataRequest(position, width, height, 1)
      image <- respondWithSpriteSheet(dataSource, dataLayer, request, 1, blackAndWhite = false)
    } yield {
      image
    }
  }

  def clearCache(dataSetName: String) = TokenSecuredAction(UserAccessRequest.administrateDataSources) {
    implicit request =>
      AllowRemoteOrigin {
        val count = binaryDataService.clearCache(dataSetName)
        Ok("Closed " + count + " file handles")
      }
  }

}
