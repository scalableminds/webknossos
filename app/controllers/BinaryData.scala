package controllers

import play.api._
import play.api.mvc._
import play.api.Play.current
import play.api.libs.iteratee._
import play.api.libs.concurrent._
import models.binary._
import models.user.User
import models.annotation.AnnotationDAO
import models.tracing.volume.VolumeTracing
import scala.concurrent.Future
import oxalis.security._
import braingames.geometry.Point3D
import scala.concurrent.Future
import play.api.i18n.Messages
import braingames.image._
import braingames.image.JPEGWriter
import braingames.binary.models._
import braingames.binary._
import oxalis.binary.BinaryDataService
import net.liftweb.common._
import braingames.util.ExtendedTypes.ExtendedFutureBox
import braingames.util.ExtendedTypes.ExtendedArraySeq
import braingames.binary.{ParsedDataReadRequest, ParsedDataWriteRequest, ParsedRequestCollection, DataRequestSettings}
import oxalis.security.AuthenticatedRequest
import scala.Some
import braingames.image.ImageCreatorParameters
import braingames.reactivemongo.DBAccessContext
import braingames.util.Fox
import reactivemongo.bson.BSONObjectID

object BinaryData extends Controller with Secured {

  val conf = Play.configuration

  implicit val dispatcher = Akka.system.dispatcher
  val scaleFactors = Array(1, 1, 1)

  def createDataRequestCollection(dataSet: DataSet, dataLayer: DataLayer, cubeSize: Int, parsedRequest: ParsedRequestCollection[ParsedDataReadRequest]) = {
    dataSet.dataSource.map {
      source =>
        val dataRequests = parsedRequest.requests.map(r =>
          BinaryDataService.createDataReadRequest(source, dataLayer, None, cubeSize, r))
        DataRequestCollection(dataRequests)
      }
  }

  def requestData(
                   dataSetName: String,
                   dataLayerName: String,
                   cubeSize: Int,
                   parsedRequest: ParsedRequestCollection[ParsedDataReadRequest],
                   annotationId: Option[String],
                   userOpt: Option[User]
                 )(implicit ctx: DBAccessContext): Fox[Array[Byte]] = {
    for {
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
      dataLayer <- getDataLayer(dataSet, dataLayerName, annotationId, userOpt) ?~> Messages("dataLayer.notFound")
      dataRequestCollection <- createDataRequestCollection(dataSet, dataLayer, cubeSize, parsedRequest) ?~> Messages("dataSet.source.notFound")
      data <- BinaryDataService.handleDataRequest(dataRequestCollection) ?~> "Data request couldn't get handled"
    } yield {
      data
    }
  }

  def requestData(
                   dataSetName: String,
                   dataLayerName: String,
                   position: Point3D,
                   width: Int,
                   height: Int,
                   depth: Int,
                   resolutionExponent: Int,
                   settings: DataRequestSettings,
                   annotationId: Option[String] = None,
                   userOpt: Option[User] = None
                 )(implicit ctx: DBAccessContext): Fox[Array[Byte]] = {
    for {
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
      dataSource <- dataSet.dataSource ?~> Messages("dataSet.source.notFound")
      dataLayer <- getDataLayer(dataSet, dataLayerName, annotationId, userOpt) ?~> Messages("dataLayer.notFound")

      dataRequestCollection = BinaryDataService.createDataReadRequest(
        dataSource,
        dataLayer,
        None,
        width,
        height,
        depth,
        position,
        resolutionExponent,
        settings)
      data <- BinaryDataService.handleDataRequest(dataRequestCollection) ?~> "Data request couldn't get handled"
    } yield {
      data
    }
  }

  def createDataWriteRequestCollection(dataSet: DataSet, dataLayer: DataLayer, cubeSize: Int, parsedRequest: ParsedRequestCollection[ParsedDataWriteRequest]) = {
    for{
      dataSource <- dataSet.dataSource
    } yield {
      val dataRequests = parsedRequest.requests.map(r =>
        BinaryDataService.createDataWriteRequest(dataSource, dataLayer, None, cubeSize, r))
      DataRequestCollection(dataRequests)
    }
  }

  def writeData(
               dataSet: DataSet,
               dataLayer: DataLayer,
               cubeSize: Int,
               parsedRequest: ParsedRequestCollection[ParsedDataWriteRequest],
               annotationId: String,
               userOpt: Option[User]
              )(implicit ctx: DBAccessContext) = {
    for{
      dataWriteRequestCollection <- createDataWriteRequestCollection(dataSet, dataLayer, cubeSize, parsedRequest).toFox
      r <- BinaryDataService.handleDataRequest(dataWriteRequestCollection).map(_ => true).toFox
    } yield r
  }

  def requestViaAjaxDebug(dataSetName: String, dataLayerName: String, cubeSize: Int, x: Int, y: Int, z: Int, resolution: Int, annotationId: Option[String]) = Authenticated.async {
    implicit request =>
      val dataRequests = ParsedRequestCollection(Array(ParsedDataReadRequest(resolution, Point3D(x, y, z), false)))
      for {
        data <- requestData(dataSetName, dataLayerName, cubeSize, dataRequests, annotationId, Some(request.user))
      } yield {
        Ok(data)
      }
  }

  def tryGetUserDataLayer(dataSet: DataSet, dataLayerName: String, annotationId: Option[String], userOpt: Option[User])(implicit ctx: DBAccessContext): Fox[DataLayer] = {
    // TODO: FIXME - this doesn't always work, sometimes the 'annotationId' sent is actualy the dataset name
    for {
      id <- annotationId.flatMap(BSONObjectID.parse(_).toOption).toFox
      annotation <- AnnotationDAO.findOneById(id).toFox
      if annotation.restrictions.allowAccess(userOpt)
      VolumeTracing(_, userDataLayerName, _, _, _, _, _) <- annotation.content
      userDataLayer <- UserDataLayerDAO.findOneByName(userDataLayerName).toFox
      if userDataLayer.dataSourceName == dataSet.name
    } yield {
      userDataLayer.dataLayer
    }
  }

  def getDataLayer(dataSet: DataSet, dataLayerName: String, annotationId: Option[String], userOpt: Option[User])(implicit ctx: DBAccessContext): Fox[DataLayer] = {
    tryGetUserDataLayer(dataSet, dataLayerName, annotationId, userOpt).orElse(
      for {
        dataSource <- dataSet.dataSource
        dataLayer <- dataSource.getDataLayer(dataLayerName)
      } yield {
        dataLayer
      }
    )
  }

  /**
   * Handles a request for binary data via a HTTP POST. The content of the
   * POST body is specified in the BinaryProtokoll.parseAjax functions.
   */

  def requestViaAjax(dataSetName: String, dataLayerName: String, cubeSize: Int, annotationId: Option[String]) = UserAwareAction.async(parse.raw) {
    implicit request =>
      for {
        payload <- request.body.asBytes() ?~> Messages("binary.payload.notSupplied")
        requests <- BinaryProtocol.parseDataReadRequests(payload, containsHandle = false) ?~> Messages("binary.payload.invalid")
        data <- requestData(dataSetName, dataLayerName, cubeSize, requests, annotationId, request.userOpt) ?~> Messages("binary.data.notFound")
      } yield {
        Ok(data)
      }
  }

  def respondWithSpriteSheet(dataSetName: String, dataLayerName: String, width: Int, height: Int, depth: Int, imagesPerRow: Int, x: Int, y: Int, z: Int, resolution: Int)(implicit request: UserAwareRequest[_]): Future[SimpleResult] = {
    val settings = DataRequestSettings(useHalfByte = false, skipInterpolation = false)
    for {
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
      dataSource <- dataSet.dataSource ?~> Messages("dataSet.source.notFound")
      dataLayer <- dataSource.getDataLayer(dataLayerName) ?~> Messages("dataLayer.notFound")
      params = ImageCreatorParameters(dataLayer.bytesPerElement, width, height, imagesPerRow)
      data <- requestData(dataSetName, dataLayerName, Point3D(x, y, z), width, height, depth, resolution, settings) ?~> Messages("binary.data.notFound")
      spriteSheet <- ImageCreator.spriteSheetFor(data, params) ?~> Messages("image.create.failed")
      firstSheet <- spriteSheet.pages.headOption ?~> "Couldn'T create spritesheet"
    } yield {
      val file = new JPEGWriter().writeToFile(firstSheet.image)
      Ok.sendFile(file, true, _ => "test.jpg").withHeaders(
        CONTENT_TYPE -> "image/jpeg")
    }
  }

  def respondWithImage(dataSetName: String, dataLayerName: String, width: Int, height: Int, x: Int, y: Int, z: Int, resolution: Int)(implicit request: UserAwareRequest[_]) = {
    respondWithSpriteSheet(dataSetName, dataLayerName, width, height, 1, 1, x, y, z, resolution)
  }

  def requestSpriteSheet(dataSetName: String, dataLayerName: String, cubeSize: Int, imagesPerRow: Int, x: Int, y: Int, z: Int, resolution: Int) = UserAwareAction.async(parse.raw) {
    implicit request =>
      respondWithSpriteSheet(dataSetName, dataLayerName, cubeSize, cubeSize, cubeSize, imagesPerRow, x, y, z, resolution)
  }

  def requestImage(dataSetName: String, dataLayerName: String, width: Int, height: Int, x: Int, y: Int, z: Int, resolution: Int) = UserAwareAction.async(parse.raw) {
    implicit request =>
      respondWithImage(dataSetName, dataLayerName, width, height, x, y, z, resolution)
  }

  // TODO: Move maxContentLength to config
  def writeViaAjax(dataSetName: String, dataLayerName: String, cubeSize: Int, annotationId: String) = UserAwareAction.async(parse.raw(1048576)) {
    implicit request =>
      for {
        dataSet <- DataSetDAO.findOneBySourceName(dataSetName).toFox ?~> Messages("dataSet.notFound")
        dataLayer <- tryGetUserDataLayer(dataSet, dataLayerName, Some(annotationId), request.userOpt) ?~> Messages("dataLayer.test")
        payloadBodySize = cubeSize * cubeSize * cubeSize * dataLayer.bytesPerElement
        payload <- request.body.asBytes() ?~> Messages("binary.payload.notSupplied")
        requests <- BinaryProtocol.parseDataWriteRequests(payload, payloadBodySize, containsHandle = false) ?~> Messages("binary.payload.invalid")
        _ <- writeData(dataSet, dataLayer, cubeSize, requests, annotationId, request.userOpt)
      } yield Ok
  }
}

  /**
   * Handles a request for binary data via websockets. The content of a websocket
   * message is defined in the BinaryProtokoll.parseWebsocket function.
   * If the message is valid the result is posted onto the websocket.
   *
   */

  //  def requestViaWebsocket(dataSetName: String, dataLayerName: String, cubeSize: Int): WebSocket[Array[Byte]] =
  //    AuthenticatedWebSocket[Array[Byte]]() {
  //      user =>
  //        request =>
  //          DataSetDAO.findOneByName(dataSetName)(user).map {
  //            dataSetOpt =>
  //              var channelOpt: Option[Channel[Array[Byte]]] = None
  //
  //              val output = Concurrent.unicast[Array[Byte]](
  //              {
  //                c => channelOpt = Some(c)
  //              }, {
  //                Logger.debug("Data websocket completed")
  //              }, {
  //                case (e, i) => Logger.error("An error ocourd on websocket stream: " + e)
  //              })
  //
  //              val input = Iteratee.foreach[Array[Byte]](in => {
  //                for {
  //                  dataSet <- dataSetOpt
  //                  dataLayer: DataLayer <- dataSet.dataLayer(dataLayerName) ?~> Messages("dataLayer.notFound")             
  //                  channel <- channelOpt
  //                  requests <- BinaryProtocol.parse(in, containsHandle = true)
  //                  dataRequestCollection = createDataRequestCollection(dataSet, dataLayer, cubeSize, requests)
  //                  dataOpt <- BinaryDataService.handleDataRequest(dataRequestCollection)
  //                  data <- dataOpt
  //                } {
  //                  val resultWithHandle = Seq(data, requests.handle.getOrElse(Array())).appendArrays
  //                  channel.push(resultWithHandle)
  //                }
  //              })
  //              (input, output)
  //          }
  //    }
