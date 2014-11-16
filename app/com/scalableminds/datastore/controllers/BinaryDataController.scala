/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.datastore.controllers

import play.api._
import play.api.Play.current
import play.api.libs.concurrent._
import com.scalableminds.util.geometry.Point3D
import play.api.i18n.Messages
import com.scalableminds.braingames.binary.models._
import com.scalableminds.datastore.models._
import com.scalableminds.braingames.binary._
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{FoxImplicits, Fox}
import play.api.mvc.{SimpleResult, Action}
import com.scalableminds.braingames.binary.ParsedDataReadRequest
import com.scalableminds.braingames.binary.DataRequestSettings
import com.scalableminds.braingames.binary.ParsedDataWriteRequest
import com.scalableminds.braingames.binary.ParsedRequestCollection
import com.scalableminds.braingames.binary.MappingRequest
import scala.concurrent.Future
import com.scalableminds.util.image.{JPEGWriter, ImageCreator, ImageCreatorParameters}
import com.scalableminds.util.mvc.ExtendedController
import com.scalableminds.datastore.services.{UserDataLayerService, UserAccessService, BinaryDataService}
import com.scalableminds.datastore.models.DataSourceDAO
import play.api.mvc.BodyParsers.parse
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.datastore.DataStorePlugin
import java.io.File
import play.api.libs.json.Json
import org.apache.commons.io.FileUtils
import org.apache.commons.io.IOUtils
import org.apache.commons.codec.binary.Base64
import java.io.{PipedInputStream, PipedOutputStream}
import play.api.libs.iteratee.Enumerator

object BinaryDataController extends BinaryDataReadController with BinaryDataWriteController with BinaryDataDownloadController

trait BinaryDataCommonController extends Controller with FoxImplicits{
  protected def getDataLayer(dataSource: DataSource, dataLayerName: String): Fox[DataLayer] = {
    dataSource.getDataLayer(dataLayerName).toFox orElse UserDataLayerService.findUserDataLayer(dataSource.id, dataLayerName)
  }

  import play.api.mvc._

  case class TokenSecuredAction(dataSetName: String, dataLayerName: String) extends ActionBuilder[Request] {

    def invokeBlock[A](request: Request[A], block: (Request[A]) => Future[SimpleResult]) = {
      val hasAccess = request.getQueryString("token").map{ token =>
        UserAccessService.hasAccess(token, dataSetName, dataLayerName)
      } getOrElse Future.successful(false)

      hasAccess.flatMap{
        case true =>
          block(request)
        case false =>
          Future.successful(Forbidden("Invalid access token."))
      }
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
                           resolution: Int) = TokenSecuredAction(dataSetName, dataLayerName).async {
    implicit request =>
      AllowRemoteOrigin{
        val dataRequests = ParsedRequestCollection(Array(ParsedDataReadRequest(resolution, Point3D(x, y, z), false)))
        for {
          data <- requestData(dataSetName, dataLayerName, cubeSize, dataRequests)
        } yield {
          Ok(data)
        }
      }
  }

  /**
   * Handles a request for binary data via a HTTP POST. The content of the
   * POST body is specified in the BinaryProtokoll.parseAjax functions.
   */

  def requestViaAjax(dataSetName: String, dataLayerName: String, cubeSize: Int) = TokenSecuredAction(dataSetName, dataLayerName).async(parse.raw) {
    implicit request =>
      AllowRemoteOrigin{
        for {
          payload <- request.body.asBytes() ?~> Messages("binary.payload.notSupplied")
          requests <- BinaryProtocol.parseDataReadRequests(payload, containsHandle = false) ?~> Messages("binary.payload.invalid")
          data <- requestData(dataSetName, dataLayerName, cubeSize, requests) ?~> Messages("binary.data.notFound")
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
                          resolution: Int) = TokenSecuredAction(dataSetName, dataLayerName).async(parse.raw) {
    implicit request =>
      AllowRemoteOrigin{
        for{
          image <- respondWithSpriteSheet(dataSetName, dataLayerName, cubeSize, cubeSize, cubeSize, imagesPerRow, x, y, z, resolution)
        } yield {
          Ok.sendFile(image, true, _ => "test.jpg").withHeaders(
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
                    resolution: Int) = TokenSecuredAction(dataSetName, dataLayerName).async(parse.raw) {
    implicit request =>
      AllowRemoteOrigin{
        for{
          image <- respondWithImage(dataSetName, dataLayerName, width, height, x, y, z, resolution)
        } yield {
          Ok.sendFile(image, true, _ => "test.jpg").withHeaders(
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
      AllowRemoteOrigin{
        for {
          thumbnail <- requestImageThumbnail(dataSetName, dataLayerName, width, height)
        } yield {
          Ok.sendFile(thumbnail, true, _ => "thumbnail.jpg").withHeaders(
            CONTENT_TYPE -> contentTypeJpeg)
        }
      }
  }

  private def requestImageThumbnail(
                    dataSetName: String,
                    dataLayerName: String,
                    width: Int,
                    height: Int) = {

      def bestResolution(dataLayer: DataLayer): Int = {
        val wr = math.floor(math.log(dataLayer.boundingBox.width.toDouble / width) / math.log(2)).toInt
        val hr = math.floor(math.log(dataLayer.boundingBox.height.toDouble / height) / math.log(2)).toInt

        math.max(0, List(wr, hr, (dataLayer.resolutions.size-1)).min)
      }

      def goodThumbnailParameters(dataLayer: DataLayer) = {
        // Parameters that seem to be working good enough
        val center = dataLayer.boundingBox.center
        val resolution = bestResolution(dataLayer)
        val x = center.x / math.pow(2, resolution) - width / 2
        val y = center.y / math.pow(2, resolution) - height / 2
        val z = center.z / math.pow(2, resolution)
        (x.toInt, y.toInt, z.toInt, resolution)
      }

      for{
        usableDataSource <- DataSourceDAO.findUsableByName(dataSetName) ?~> Messages("dataSource.unavailable")
        dataSource = usableDataSource.dataSource
        dataLayer <- getDataLayer(dataSource, dataLayerName)
        (x,y,z, resolution) = goodThumbnailParameters(dataLayer)
        image <- respondWithImage(dataSetName, dataLayerName, width, height, x, y, z, resolution)
      } yield {
        image
      }
  }

  private def createDataRequestCollection(
                                           dataSource: DataSource,
                                           dataLayer: DataLayer,
                                           cubeSize: Int,
                                           parsedRequest: ParsedRequestCollection[ParsedDataReadRequest]) = {
    val dataRequests = parsedRequest.requests.map(r =>
      DataStorePlugin.binaryDataService.createDataReadRequest(dataSource, dataLayer, None, cubeSize, r))
    DataRequestCollection(dataRequests)
  }


  private def requestData(
                           dataSetName: String,
                           dataLayerName: String,
                           cubeSize: Int,
                           parsedRequest: ParsedRequestCollection[ParsedDataReadRequest]): Fox[Array[Byte]] = {
    for {
      usableDataSource <- DataSourceDAO.findUsableByName(dataSetName) ?~> Messages("datasource.unavailable")
      dataSource = usableDataSource.dataSource
      dataLayer <- getDataLayer(dataSource, dataLayerName) ?~> Messages("dataLayer.notFound")
      dataRequestCollection = createDataRequestCollection(dataSource, dataLayer, cubeSize, parsedRequest)
      data <- DataStorePlugin.binaryDataService.handleDataRequest(dataRequestCollection) ?~> "Data request couldn't get handled"
    } yield {
      data
    }
  }

  private def requestData(
                           dataSetName: String,
                           dataLayerName: String,
                           position: Point3D,
                           width: Int,
                           height: Int,
                           depth: Int,
                           resolutionExponent: Int,
                           settings: DataRequestSettings): Fox[Array[Byte]] = {
    for {
      usableDataSource <- DataSourceDAO.findUsableByName(dataSetName) ?~> Messages("datasource.unavailable")
      dataSource = usableDataSource.dataSource
      dataLayer <- getDataLayer(dataSource, dataLayerName) ?~> Messages("dataLayer.notFound")

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

  private def respondWithSpriteSheet(
                              dataSetName: String,
                              dataLayerName: String,
                              width: Int,
                              height: Int,
                              depth: Int,
                              imagesPerRow: Int,
                              x: Int,
                              y: Int,
                              z: Int,
                              resolution: Int): Fox[File] = {
    val settings = DataRequestSettings(useHalfByte = false, skipInterpolation = false)
    for {
      usableDataSource <- DataSourceDAO.findUsableByName(dataSetName) ?~> Messages("dataSource.unavailable")
      dataSource = usableDataSource.dataSource
      dataLayer <- getDataLayer(dataSource, dataLayerName) ?~> Messages("dataLayer.notFound")
      params = ImageCreatorParameters(dataLayer.bytesPerElement, width, height, imagesPerRow)
      data <- requestData(dataSetName, dataLayerName, Point3D(x, y, z), width, height, depth, resolution, settings) ?~> Messages("binary.data.notFound")
      spriteSheet <- ImageCreator.spriteSheetFor(data, params) ?~> Messages("image.create.failed")
      firstSheet <- spriteSheet.pages.headOption ?~> "Couldn'T create spritesheet"
    } yield {
      new JPEGWriter().writeToFile(firstSheet.image)
    }
  }

  private def respondWithImage(
                                dataSetName: String,
                                dataLayerName: String,
                                width: Int,
                                height: Int,
                                x: Int,
                                y: Int,
                                z: Int,
                                resolution: Int) = {
    respondWithSpriteSheet(dataSetName, dataLayerName, width, height, 1, 1, x, y, z, resolution)
  }
}

trait BinaryDataWriteController extends BinaryDataCommonController {

  private def createDataWriteRequestCollection(
                                        dataSource: DataSource,
                                        dataLayer: DataLayer,
                                        cubeSize: Int,
                                        parsedRequest: ParsedRequestCollection[ParsedDataWriteRequest]) = {
    val dataRequests = parsedRequest.requests.map(r =>
      DataStorePlugin.binaryDataService.createDataWriteRequest(dataSource, dataLayer, None, cubeSize, r))
    DataRequestCollection(dataRequests)
  }


  private def writeData(
                 dataSource: DataSource,
                 dataLayer: DataLayer,
                 cubeSize: Int,
                 parsedRequest: ParsedRequestCollection[ParsedDataWriteRequest]): Fox[Boolean] = {
    val dataWriteRequestCollection = createDataWriteRequestCollection(dataSource, dataLayer, cubeSize, parsedRequest)
    dataWriteRequestCollection.requests.map(VolumeUpdateService.store)
    DataStorePlugin.binaryDataService.handleDataRequest(dataWriteRequestCollection).map(_ => true)
  }

  def writeViaAjax(dataSetName: String, dataLayerName: String, cubeSize: Int) = TokenSecuredAction(dataSetName, dataLayerName).async(parse.raw(1048576)) {
    implicit request =>
      AllowRemoteOrigin{
        for {
          usableDataSource <- DataSourceDAO.findUsableByName(dataSetName).toFox ?~> Messages("dataSet.notFound")
          dataSource = usableDataSource.dataSource
          dataLayer <- getDataLayer(dataSource, dataLayerName) ?~> Messages("dataLayer.notFound")
          if (dataLayer.isWritable)
          payloadBodySize = cubeSize * cubeSize * cubeSize * dataLayer.bytesPerElement
          payload <- request.body.asBytes() ?~> Messages("binary.payload.notSupplied")
          requests <- BinaryProtocol.parseDataWriteRequests(payload, payloadBodySize, containsHandle = false) ?~> Messages("binary.payload.invalid")
          _ <- writeData(dataSource, dataLayer, cubeSize, requests)
        } yield Ok
      }
  }

  def requestSegmentationMapping(dataSetName: String, dataLayerName: String) = TokenSecuredAction(dataSetName, dataLayerName).async {
    implicit request =>
      AllowRemoteOrigin{
        for {
          usableDataSource <- DataSourceDAO.findUsableByName(dataSetName).toFox ?~> Messages("dataSet.notFound")
          dataSource = usableDataSource.dataSource
          dataLayer <- getDataLayer(dataSource, dataLayerName) ?~> Messages("dataLayer.notFound")
          if (dataLayer.category == "segmentation")
          result <- DataStorePlugin.binaryDataService.handleMappingRequest(MappingRequest(dataSource, dataLayer)).toFox
        } yield {
          Ok(result)
        }
      }
  }
}

trait BinaryDataDownloadController extends BinaryDataCommonController {

  def downloadDataLayer(dataSetName: String, dataLayerName: String) = Action.async {
    implicit request =>
      AllowRemoteOrigin{
        val inputStream = new PipedInputStream()
        for {
          usableDataSource <- DataSourceDAO.findUsableByName(dataSetName).toFox ?~> Messages("dataSet.notFound")
          dataSource = usableDataSource.dataSource
          dataLayer <- getDataLayer(dataSource, dataLayerName) ?~> Messages("dataLayer.notFound")
          if (dataLayer.category == "segmentation")
          result <- DataStorePlugin.binaryDataService.handleDownloadRequest(DataDownloadRequest(dataLayer, new PipedOutputStream(inputStream)))
        } yield {
          Ok.stream(Enumerator.fromStream(inputStream)).withHeaders(
            CONTENT_TYPE ->
              "application/octet-stream",
            CONTENT_DISPOSITION ->
              s"filename=${dataLayerName}.zip")
        }
      }
  }

}
