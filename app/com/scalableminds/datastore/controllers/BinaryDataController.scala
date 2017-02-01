/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore.controllers

import javax.inject.Inject

import play.api.libs.json._
import com.scalableminds.util.geometry.Point3D
import play.api.i18n.{I18nSupport, Messages, MessagesApi}
import com.scalableminds.braingames.binary.models.{DataRequestSettings, _}
import com.scalableminds.datastore.models._
import com.scalableminds.braingames.binary._
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.braingames.binary.MappingRequest

import scala.concurrent.Future
import com.scalableminds.util.image.{ImageCreator, ImageCreatorParameters, JPEGWriter}
import com.scalableminds.datastore.services.{DataSetAccessService, UserAccessService, UserDataLayerService}
import com.scalableminds.datastore.models.DataSourceDAO
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.datastore.DataStorePlugin
import java.io.File

import org.apache.commons.io.FileUtils
import org.apache.commons.codec.binary.Base64
import play.api.libs.iteratee.Enumerator
import com.scalableminds.datastore.models.DataProtocol
import net.liftweb.common._
import play.api.{Mode, Play}

class BinaryDataController @Inject()(val messagesApi: MessagesApi)
  extends BinaryDataReadController
    with BinaryDataWriteController
    with BinaryDataDownloadController
    with BinaryDataMappingController

trait BinaryDataCommonController extends Controller with FoxImplicits with I18nSupport {

  val debugModeEnabled: Boolean = Play.current.configuration.getBoolean("datastore.debugMode") getOrElse false

  protected def getDataSourceAndDataLayer(dataSetName: String, dataLayerName: String): Fox[(DataSource, DataLayer)] = {
    for {
      usableDataSource <- DataSourceDAO.findUsableByName(dataSetName) ?~> Messages("dataSource.unavailable") ~> 404
      dataSource = usableDataSource.dataSource
      dataLayer <- dataSource.getDataLayer(dataLayerName).toFox orElse UserDataLayerService.findUserDataLayer(dataSource.id, dataLayerName) ?~> Messages("dataLayer.notFound")
    } yield {
      (dataSource, dataLayer)
    }
  }

  import play.api.mvc._

  case class TokenSecuredAction(dataSetName: String, dataLayerName: String) extends ActionBuilder[Request] {

    def invokeBlock[A](request: Request[A], block: (Request[A]) => Future[Result]): Future[Result] = {
      hasUserAccess(request).flatMap {
        case true =>
          block(request)
        case _ if debugModeEnabled && Play.mode(Play.current) != Mode.Prod =>
          // If we are in development mode, lets skip tokens
          block(request)
        case false =>
          hasDataSetTokenAccess(request).flatMap {
            case true =>
              block(request)
            case false =>
              Future.successful(Forbidden("Invalid access token."))
          }
      }
    }

    private def hasUserAccess[A](request: Request[A]): Future[Boolean] = {
      request.getQueryString("token").map { token =>
        UserAccessService.hasAccess(token, dataSetName, dataLayerName)
      } getOrElse Future.successful(false)
    }

    private def hasDataSetTokenAccess[A](request: Request[A]): Future[Boolean] = {
      request.getQueryString("datasetToken").map { layerToken =>
        DataSetAccessService.hasAccess(layerToken, dataSetName)
      } getOrElse Future.successful(false)
    }
  }

}

trait BinaryDataReadController extends BinaryDataCommonController {

  def requestViaAjaxDebug(
                           dataSetName: String,
                           dataLayerName: String,
                           cubeSize: Int,
                           x: Int,
                           y: Int,
                           z: Int,
                           resolution: Int,
                           halfByte: Boolean) = TokenSecuredAction(dataSetName, dataLayerName).async {
    implicit request =>
      AllowRemoteOrigin {
        val settings = DataRequestSettings(useHalfByte = halfByte)
        for {
          data <- requestData(dataSetName, dataLayerName, Point3D(x, y, z), cubeSize, cubeSize, cubeSize, resolution, settings)
        } yield {
          Ok(data)
        }
      }
  }

  /**
    * Handles a request for binary data via a HTTP POST. The content of the
    * POST body is specified in the DataProtocol.readRequestParser BodyParser.
    */

  def requestViaAjax(
                      dataSetName: String,
                      dataLayerName: String) = TokenSecuredAction(dataSetName, dataLayerName).async(DataProtocol.readRequestParser) {

    def validateRequests(requests: Seq[Box[DataProtocolReadRequest]]) = {
      requests.find(_.isEmpty) match {
        case Some(Failure(msg, _, _)) => Failure(msg)
        case None => Full(requests.flatten.toList)
        case _ => Empty
      }
    }

    implicit request =>
      AllowRemoteOrigin {
        for {
          requests <- validateRequests(request.body.files.map(_.ref)).toFox
          data <- requestData(dataSetName, dataLayerName, requests)
        } yield {
          Ok(data)
        }
      }
  }

  /**
    * Handles a request for binary data via a HTTP GET. Mostly used by knossos.
    */

  def requestViaKnossos(
                         dataSetName: String,
                         dataLayerName: String,
                         resolution: Int,
                         x: Int, y: Int, z: Int,
                         cubeSize: Int) = TokenSecuredAction(dataSetName, dataLayerName).async {
    implicit request =>
      AllowRemoteOrigin {
        val logRes = (math.log(resolution) / math.log(2)).toInt
        val position = Point3D(x * cubeSize * resolution, y * cubeSize * resolution, z * cubeSize * resolution)
        for {
          data <- requestData(dataSetName, dataLayerName, position, cubeSize, cubeSize, cubeSize, logRes) ?~> Messages("binary.data.notFound")
        } yield {
          Ok(data)
        }
      }
  }

  def requestSpriteSheet(
                          dataSetName: String,
                          dataLayerName: String,
                          cubeSize: Int,
                          imagesPerRow: Int,
                          x: Int,
                          y: Int,
                          z: Int,
                          resolution: Int,
                          halfByte: Boolean) = TokenSecuredAction(dataSetName, dataLayerName).async(parse.raw) {
    implicit request =>
      AllowRemoteOrigin {
        val settings = DataRequestSettings(useHalfByte = halfByte)
        for {
          image <- respondWithSpriteSheet(
            dataSetName, dataLayerName, cubeSize, cubeSize, cubeSize, imagesPerRow,
            x, y, z, resolution, settings, blackAndWhite = false)
        } yield {
          Ok.sendFile(image, inline = true, fileName = _ => "test.jpg").withHeaders(
            CONTENT_TYPE -> contentTypeJpeg)
        }
      }
  }

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
                    blackAndWhite: Boolean) = TokenSecuredAction(dataSetName, dataLayerName).async(parse.raw) {
    implicit request =>
      AllowRemoteOrigin {
        val settings = DataRequestSettings(useHalfByte = halfByte)
        for {
          image <- respondWithImage(dataSetName, dataLayerName, width, height, x, y, z, resolution, settings, blackAndWhite)
        } yield {
          Ok.sendFile(image, inline = true, fileName = _ => "test.jpg").withHeaders(
            CONTENT_TYPE -> contentTypeJpeg)
        }
      }
  }

  def contentTypeJpeg = play.api.libs.MimeTypes.forExtension("jpeg").getOrElse(play.api.http.ContentTypes.BINARY)

  def requestImageThumbnailJson(
                                 dataSetName: String,
                                 dataLayerName: String,
                                 width: Int,
                                 height: Int) = TokenSecuredAction(dataSetName, dataLayerName).async(parse.raw) {
    implicit request =>
      AllowRemoteOrigin {
        for {
          thumbnail <- requestImageThumbnail(dataSetName, dataLayerName, width, height)
        } yield {
          Ok(Json.obj(
            "mimeType" -> contentTypeJpeg,
            "value" -> Base64.encodeBase64String(FileUtils.readFileToByteArray(thumbnail))))
        }
      }
  }

  def requestImageThumbnailJpeg(
                                 dataSetName: String,
                                 dataLayerName: String,
                                 width: Int,
                                 height: Int) = TokenSecuredAction(dataSetName, dataLayerName).async(parse.raw) {
    implicit request =>
      AllowRemoteOrigin {
        for {
          thumbnail <- requestImageThumbnail(dataSetName, dataLayerName, width, height)
        } yield {
          Ok.sendFile(thumbnail, inline = true, fileName = _ => "thumbnail.jpg").withHeaders(
            CONTENT_TYPE -> contentTypeJpeg)
        }
      }
  }

  protected def requestData(
                             dataSetName: String,
                             dataLayerName: String,
                             requests: List[DataProtocolReadRequest]): Fox[Array[Byte]] = {

    def createRequestCollection(
                                 dataSource: DataSource,
                                 dataLayer: DataLayer,
                                 requests: List[DataProtocolReadRequest]) = {
      val dataRequests = requests.map(r =>
        DataStorePlugin.binaryDataService.createDataReadRequest(
          dataSource,
          dataLayer,
          None,
          r.cubeSize,
          r.cubeSize,
          r.cubeSize,
          r.position,
          r.zoomStep,
          DataRequestSettings(r.fourBit getOrElse false)))
      DataRequestCollection(dataRequests)
    }

    for {
      (dataSource, dataLayer) <- getDataSourceAndDataLayer(dataSetName, dataLayerName)
      dataRequestCollection = createRequestCollection(dataSource, dataLayer, requests)
      data <- DataStorePlugin.binaryDataService.handleDataRequest(dataRequestCollection) ?~> "Data request couldn't get handled"
    } yield {
      data
    }
  }

  protected def requestData(
                             dataSetName: String,
                             dataLayerName: String,
                             position: Point3D,
                             width: Int,
                             height: Int,
                             depth: Int,
                             resolutionExponent: Int,
                             settings: DataRequestSettings = DataRequestSettings.default): Fox[Array[Byte]] = {
    for {
      (dataSource, dataLayer) <- getDataSourceAndDataLayer(dataSetName, dataLayerName)
      dataRequestCollection = DataStorePlugin.binaryDataService.createDataReadRequest(
        dataSource,
        dataLayer,
        None,
        width,
        height,
        depth,
        position,
        resolutionExponent,
        settings)
      data <- DataStorePlugin.binaryDataService.handleDataRequest(dataRequestCollection) ?~> "Data request couldn't get handled"
    } yield {
      data
    }
  }

  def requestImageData(
                        dataSetName: String,
                        dataLayerName: String,
                        startPoint: Point3D,
                        width: Int,
                        height: Int,
                        depth: Int,
                        resolutionExponent: Int,
                        settings: DataRequestSettings): Fox[Array[Byte]] = {
    getDataSourceAndDataLayer(dataSetName, dataLayerName).flatMap {
      case (dataSource, dataLayer) =>
        val dataRequestTemplate = DataStorePlugin.binaryDataService.createDataReadRequest(
          dataSource, dataLayer, None,
          dataSource.lengthOfLoadedBuckets, dataSource.lengthOfLoadedBuckets, dataSource.lengthOfLoadedBuckets,
          startPoint, resolutionExponent, settings)
        val resolution = dataRequestTemplate.resolution
        val position = dataSource.applyResolution(startPoint, resolution)
        val bytesPerElement = dataLayer.bytesPerElement
        val result = new Array[Byte](width * height * depth * bytesPerElement)
        val bucketLength = dataSource.lengthOfLoadedBuckets
        val minBucket = position.move(-position.x % bucketLength, -position.y % bucketLength, -position.z % bucketLength)
        val maxPosition = position.move(width, height, depth)

        val bucketQueue = for {
          x <- minBucket.x.until(maxPosition.x, bucketLength)
          y <- minBucket.y.until(maxPosition.y, bucketLength)
          z <- minBucket.z.until(maxPosition.z, bucketLength)
        } yield dataSource.unapplyResolution(Point3D(x, y, z), resolution)

        val bucketResults = Fox.serialCombined(bucketQueue.toList) { bucket =>
          val dataRequest = dataRequestTemplate.copy(cuboid = dataRequestTemplate.cuboid.copy(topLeft = bucket))
          DataStorePlugin.binaryDataService.handleDataRequest(dataRequest).map(r => dataRequest -> r)
        }

        bucketResults.map { rs =>
          rs.foreach {
            case (request, data) =>
              val bucket = dataSource.applyResolution(request.cuboid.topLeft, resolution)
              val x = math.max(position.x, bucket.x)
              var y = math.max(position.y, bucket.y)
              var z = math.max(position.z, bucket.z)

              val xMax = math.min(bucket.x + bucketLength, maxPosition.x)
              val yMax = math.min(bucket.y + bucketLength, maxPosition.y)
              val zMax = math.min(bucket.z + bucketLength, maxPosition.z)

              while (z < zMax) {
                y = math.max(position.y, bucket.y)
                while (y < yMax) {
                  val dataOffset =
                    (x % bucketLength +
                      y % bucketLength * bucketLength +
                      z % bucketLength * bucketLength * bucketLength) * bytesPerElement
                  val rx = x - position.x
                  val ry = y - position.y
                  val rz = z - position.z

                  val resultOffset = (rx + ry * width + rz * width * height) * bytesPerElement
                  try {
                    System.arraycopy(data, dataOffset, result, resultOffset, (xMax - x) * bytesPerElement)
                  } catch {
                    case e: Exception =>
                      logger.warn("Oh oh, going to break...")
                      throw e
                  }
                  y += 1
                }
                z += 1
              }
          }
          result
        }
    }
  }

  protected def requestImageThumbnail(
                                       dataSetName: String,
                                       dataLayerName: String,
                                       width: Int,
                                       height: Int) = {
    for {
      (dataSource, dataLayer) <- getDataSourceAndDataLayer(dataSetName, dataLayerName)
      (x, y, z, resolution) = DataLayerHelpers.goodThumbnailParameters(dataLayer, width, height)
      image <- respondWithImage(dataSetName, dataLayerName, width, height, x, y, z, resolution, DataRequestSettings.default)
    } yield {
      image
    }
  }

  protected def respondWithSpriteSheet(
                                        dataSetName: String,
                                        dataLayerName: String,
                                        width: Int,
                                        height: Int,
                                        depth: Int,
                                        imagesPerRow: Int,
                                        x: Int,
                                        y: Int,
                                        z: Int,
                                        resolution: Int,
                                        settings: DataRequestSettings,
                                        blackAndWhite: Boolean): Fox[File] = {
    for {
      (dataSource, dataLayer) <- getDataSourceAndDataLayer(dataSetName, dataLayerName)
      params = ImageCreatorParameters(dataLayer.bytesPerElement, settings.useHalfByte, width, height, imagesPerRow, blackAndWhite = blackAndWhite)
      data <- requestImageData(dataSetName, dataLayerName, Point3D(x, y, z), width, height, depth, resolution, settings) ?~> Messages("binary.data.notFound")
      spriteSheet <- ImageCreator.spriteSheetFor(data, params) ?~> Messages("image.create.failed")
      firstSheet <- spriteSheet.pages.headOption ?~> Messages("image.page.failed")
    } yield {
      new JPEGWriter().writeToFile(firstSheet.image)
    }
  }

  protected def respondWithImage(
                                  dataSetName: String,
                                  dataLayerName: String,
                                  width: Int,
                                  height: Int,
                                  x: Int,
                                  y: Int,
                                  z: Int,
                                  resolution: Int,
                                  settings: DataRequestSettings,
                                  blackAndWhite: Boolean = false) = {
    respondWithSpriteSheet(dataSetName, dataLayerName, width, height, 1, 1, x, y, z, resolution, settings, blackAndWhite)
  }
}

trait BinaryDataWriteController extends BinaryDataCommonController {

  protected def createRequestCollection(
                                         dataSource: DataSource,
                                         dataLayer: DataLayer,
                                         requests: List[DataProtocolWriteRequest]) = {
    val dataRequests = requests.map(r =>
      DataStorePlugin.binaryDataService.createDataWriteRequest(
        dataSource,
        dataLayer,
        None,
        r.header.cubeSize,
        r.header.cubeSize,
        r.header.cubeSize,
        r.header.position,
        r.header.zoomStep,
        r.data))
    DataRequestCollection(dataRequests)
  }

  protected def validateRequests(requests: Seq[Box[DataProtocolWriteRequest]], dataLayer: DataLayer) = {
    requests.foldLeft[Box[List[DataProtocolWriteRequest]]](Full(List.empty)) {
      case (Failure(msg, _, _), _) => Failure(msg)
      case (_, Failure(msg, _, _)) => Failure(msg)
      case (Empty, _) | (_, Empty) => Empty
      case (Full(rs), Full(r)) =>
        val expectedDataSize = r.header.cubeSize * r.header.cubeSize * r.header.cubeSize * dataLayer.bytesPerElement
        if (r.data.length == expectedDataSize)
          Full(rs :+ r)
        else
          Failure("Wrong payload length.")
    }
  }

  def writeViaAjax(dataSetName: String, dataLayerName: String) = TokenSecuredAction(dataSetName, dataLayerName).async(DataProtocol.writeRequestParser) {
    implicit request =>
      AllowRemoteOrigin {
        for {
          (dataSource, dataLayer) <- getDataSourceAndDataLayer(dataSetName, dataLayerName)
          _ <- dataLayer.isWritable ?~> "Can not write to data layer. Read only."
          // unpack parsed requests from their FileParts
          requests <- validateRequests(request.body.files.map(_.ref), dataLayer).toFox
          dataRequestCollection = createRequestCollection(dataSource, dataLayer, requests)
          _ <- Fox.combined(dataRequestCollection.requests.map(VolumeUpdateService.store))
          _ <- DataStorePlugin.binaryDataService.handleDataRequest(dataRequestCollection) ?~> "Data request couldn't get handled"
        } yield Ok
      }
  }
}

trait BinaryDataDownloadController extends BinaryDataCommonController {

  def downloadDataLayer(dataSetName: String, dataLayerName: String) = TokenSecuredAction(dataSetName, dataLayerName).async {
    implicit request =>
      AllowRemoteOrigin {
        for {
          (dataSource, dataLayer) <- getDataSourceAndDataLayer(dataSetName, dataLayerName)
          _ <- (dataLayer.category == DataLayer.SEGMENTATION.category) ?~> "Download is only possible for segmentation data"
        } yield {
          val enumerator = Enumerator.outputStream { outputStream =>
            DataStorePlugin.binaryDataService.downloadDataLayer(dataLayer, outputStream)
          }
          Ok.chunked(enumerator >>> Enumerator.eof).withHeaders(
            CONTENT_TYPE ->
              "application/zip",
            CONTENT_DISPOSITION ->
              s"filename=$dataLayerName.zip")

        }
      }
  }
}

trait BinaryDataMappingController extends BinaryDataCommonController {

  def requestSegmentationMapping(dataSetName: String, dataLayerName: String, dataLayerMappingName: String) = TokenSecuredAction(dataSetName, dataLayerName).async {
    implicit request =>
      AllowRemoteOrigin {
        for {
          (dataSource, dataLayer) <- getDataSourceAndDataLayer(dataSetName, dataLayerName)
          dataLayerMapping <- dataLayer.getMapping(dataLayerMappingName).toFox ?~> Messages("dataLayerMapping.notFound")
          mappingPath <- dataLayerMapping.path.toFox ?~> Messages("dataLayerMapping.notFound")
          result <- DataStorePlugin.binaryDataService.handleMappingRequest(MappingRequest(mappingPath)) ?~> Messages("dataLayerMapping.notLoaded")
        } yield {
          Ok(result)
        }
      }
  }

}
