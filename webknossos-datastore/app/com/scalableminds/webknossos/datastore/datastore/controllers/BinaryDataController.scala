/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.datastore.controllers

import java.io.{ByteArrayOutputStream, OutputStream}
import java.util.Base64

import com.google.inject.Inject
import com.scalableminds.webknossos.datastore.binary.api.BinaryDataService
import com.scalableminds.webknossos.datastore.binary.helpers.{DataSourceRepository, ThumbnailHelpers}
import com.scalableminds.webknossos.datastore.binary.models._
import com.scalableminds.webknossos.datastore.binary.models.datasource.{DataLayer, DataSource, SegmentationLayer}
import com.scalableminds.webknossos.datastore.binary.models.requests.{DataServiceDataRequest, DataServiceMappingRequest, DataServiceRequestSettings}
import com.scalableminds.webknossos.datastore.datastore.models.DataRequestCollection._
import com.scalableminds.webknossos.datastore.datastore.models.{DataRequest, ImageThumbnail, WebKnossosDataRequest}
import com.scalableminds.webknossos.datastore.datastore.services.{AccessTokenService, UserAccessRequest}
import com.scalableminds.webknossos.datastore.datastore.tracings.volume.VolumeTracingService
import com.scalableminds.util.image.{ImageCreator, ImageCreatorParameters, JPEGWriter}
import com.scalableminds.util.tools.Fox
import net.liftweb.util.Helpers.tryo
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.iteratee.Enumerator
import play.api.libs.json.Json

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
        requestData(dataSetName, dataLayerName, request.body).map(Ok(_))
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
        val request = DataRequest(
          new VoxelPosition(x, y, z, math.pow(2, resolution).toInt),
          width,
          height,
          depth,
          DataServiceRequestSettings(halfByte = halfByte)
        )
        requestData(dataSetName, dataLayerName, request).map(Ok(_))
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
        val request = DataRequest(
          new VoxelPosition(x * cubeSize * resolution,
            y * cubeSize * resolution,
            z * cubeSize * resolution,
            resolution),
          cubeSize,
          cubeSize,
          cubeSize)
        requestData(dataSetName, dataLayerName, request).map(Ok(_))
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
        val request = DataRequest(
          new VoxelPosition(x, y, z, math.pow(2, resolution).toInt),
          cubeSize,
          cubeSize,
          cubeSize,
          DataServiceRequestSettings(halfByte = halfByte))

        for {
          imageProvider <- respondWithSpriteSheet(dataSetName, dataLayerName, request, imagesPerRow, blackAndWhite = false)
        } yield {
          Ok.stream(Enumerator.outputStream(imageProvider).andThen(Enumerator.eof)).withHeaders(
            CONTENT_TYPE -> contentTypeJpeg,
            CONTENT_DISPOSITION -> "filename=test.jpg")
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
        val request = DataRequest(
          new VoxelPosition(x, y, z, math.pow(2, resolution).toInt),
          width,
          height,
          1,
          DataServiceRequestSettings(halfByte = halfByte))

        for {
          imageProvider <- respondWithSpriteSheet(dataSetName, dataLayerName, request, 1, blackAndWhite)
        } yield {
          Ok.stream(Enumerator.outputStream(imageProvider).andThen(Enumerator.eof)).withHeaders(
            CONTENT_TYPE -> contentTypeJpeg,
            CONTENT_DISPOSITION -> "filename=test.jpg")
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
                                 height: Int) = TokenSecuredAction(UserAccessRequest.readDataSources(dataSetName)).async(parse.raw) {
    implicit request =>
      AllowRemoteOrigin {
        for {
          thumbnailProvider <- respondWithImageThumbnail(dataSetName, dataLayerName, width, height)
        } yield {
          Ok.stream(Enumerator.outputStream(thumbnailProvider).andThen(Enumerator.eof)).withHeaders(
            CONTENT_TYPE -> contentTypeJpeg,
            CONTENT_DISPOSITION -> "filename=thumbnail.jpg")
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
                                 height: Int
                               ) = TokenSecuredAction(UserAccessRequest.readDataSources(dataSetName)).async(parse.raw) {
    implicit request =>
      AllowRemoteOrigin {
        for {
          thumbnailProvider <- respondWithImageThumbnail(dataSetName, dataLayerName, width, height)
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
                           dataSetName: String,
                           dataLayerName: String,
                           dataRequests: DataRequestCollection
                         ): Fox[Array[Byte]] = {
    for {
      (dataSource, dataLayer) <- getDataSourceAndDataLayer(dataSetName, dataLayerName)
      requests = dataRequests.map(r => DataServiceDataRequest(dataSource, dataLayer, r.cuboid, r.settings))
      data <- binaryDataService.handleDataRequests(requests)
    } yield {
      data
    }
  }

  private def contentTypeJpeg = play.api.libs.MimeTypes.forExtension("jpeg").getOrElse(play.api.http.ContentTypes.BINARY)

  private def respondWithSpriteSheet(
                                      dataSetName: String,
                                      dataLayerName: String,
                                      request: DataRequest,
                                      imagesPerRow: Int,
                                      blackAndWhite: Boolean
                                    ): Fox[(OutputStream) => Unit] = {
    for {
      (_, dataLayer) <- getDataSourceAndDataLayer(dataSetName, dataLayerName)
      params = ImageCreatorParameters(
        dataLayer.bytesPerElement,
        request.settings.halfByte,
        request.cuboid.width,
        request.cuboid.height,
        imagesPerRow,
        blackAndWhite = blackAndWhite)
      data <- requestData(dataSetName, dataLayerName, request)
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
                                     height: Int
                                   ): Fox[(OutputStream) => Unit] = {
    for {
      (_, dataLayer) <- getDataSourceAndDataLayer(dataSetName, dataLayerName)
      position = ThumbnailHelpers.goodThumbnailParameters(dataLayer, width, height)
      request = DataRequest(position, width, height, 1)
      image <- respondWithSpriteSheet(dataSetName, dataLayerName, request, 1, blackAndWhite = false)
    } yield {
      image
    }
  }
}
