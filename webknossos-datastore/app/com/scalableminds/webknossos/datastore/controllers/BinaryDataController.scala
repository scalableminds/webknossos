package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.image.{Color, JPEGWriter}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.helpers.MissingBucketHeaders
import com.scalableminds.webknossos.datastore.image.{ImageCreator, ImageCreatorParameters}
import com.scalableminds.webknossos.datastore.models.datasource.*
import com.scalableminds.webknossos.datastore.models.requests.{
  DataServiceDataRequest,
  DataServiceMappingRequest,
  DataServiceRequestSettings
}
import com.scalableminds.webknossos.datastore.models.*
import com.scalableminds.webknossos.datastore.services.*
import com.scalableminds.webknossos.datastore.services.mesh.{AdHocMeshRequest, AdHocMeshService, AdHocMeshServiceHolder}
import com.scalableminds.webknossos.datastore.slacknotification.DSSlackNotificationService
import com.scalableminds.util.box.Box.tryo
import com.scalableminds.webknossos.datastore.services.mapping.MappingService
import play.api.libs.json.Json
import play.api.mvc.*

import scala.concurrent.duration.DurationInt
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.nio.{ByteBuffer, ByteOrder}
import scala.concurrent.ExecutionContext

class BinaryDataController @Inject() (
    datasetCache: DatasetCache,
    config: DataStoreConfig,
    accessTokenService: DataStoreAccessTokenService,
    binaryDataServiceHolder: BinaryDataServiceHolder,
    mappingService: MappingService,
    slackNotificationService: DSSlackNotificationService,
    adHocMeshServiceHolder: AdHocMeshServiceHolder,
    findDataService: FindDataService
)(implicit ec: ExecutionContext, bodyParsers: PlayBodyParsers)
    extends Controller
    with MissingBucketHeaders {

  override def allowRemoteOrigin: Boolean = true

  private val MaxThumbnailDimension = 5000

  private def validateThumbnailDimensions(width: Int, height: Int): Fox[Unit] =
    Fox.fromBool(
      width > 0 && width <= MaxThumbnailDimension && height > 0 && height <= MaxThumbnailDimension
    ) ?~> s"Thumbnail width and height must be between 1 and $MaxThumbnailDimension, got ${width}x$height" ~> BAD_REQUEST

  val binaryDataService: BinaryDataService = binaryDataServiceHolder.binaryDataService
  adHocMeshServiceHolder.dataStoreAdHocMeshConfig =
    (binaryDataService, mappingService, config.Datastore.AdHocMesh.timeout, config.Datastore.AdHocMesh.actorPoolSize)
  val adHocMeshService: AdHocMeshService = adHocMeshServiceHolder.dataStoreAdHocMeshService

  def requestViaWebknossos(datasetId: ObjectId, dataLayerName: String): Action[List[WebknossosDataRequest]] =
    Action.fox(validateJson[List[WebknossosDataRequest]]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        logTime(slackNotificationService.noticeSlowRequest, durationThreshold = 10 minutes) {
          val t = Instant.now
          for {
            (dataSource, dataLayer) <- datasetCache.getWithLayer(
              datasetId,
              dataLayerName
            ) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
            (data, emptyIndices, failureIndices) <- requestData(datasetId, dataSource.id, dataLayer, request.body)
            duration = Instant.since(t)
            _ = if (duration > (10 seconds))
              logger.info(
                s"Complete data request for $datasetId/$dataLayerName took ${formatDuration(duration)}."
                  + request.body.headOption
                    .map(firstReq => s" First of ${request.body.size} requests was $firstReq")
                    .getOrElse("")
              )
          } yield Ok(data).withHeaders(createMissingBucketsHeaders(emptyIndices, failureIndices)*)
        }
      }
    }

  /** Handles requests for raw binary data via HTTP GET.
    */
  def requestRawCuboid(
      datasetId: ObjectId,
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
  ): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
        magParsed <- Vec3Int.fromMagLiteral(mag).toFox ?~> Msg.Dataset.Mag.invalid(mag)
        dataRequest = DataRequest(
          VoxelPosition(x, y, z, magParsed),
          width,
          height,
          depth,
          DataServiceRequestSettings(halfByte = halfByte, appliedAgglomerate = mappingName)
        )
        (data, emptyIndices, failureIndices) <- requestData(datasetId, dataSource.id, dataLayer, List(dataRequest))
      } yield Ok(data).withHeaders(createMissingBucketsHeaders(emptyIndices, failureIndices)*)
    }
  }

  def requestRawCuboidPost(datasetId: ObjectId, dataLayerName: String): Action[RawCuboidRequest] =
    Action.fox(validateJson[RawCuboidRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ~> NOT_FOUND
          (data, emptyIndices, failureIndices) <- requestData(datasetId, dataSource.id, dataLayer, List(request.body))
        } yield Ok(data).withHeaders(createMissingBucketsHeaders(emptyIndices, failureIndices)*)
      }
    }

  /** Handles a request for raw binary data via a HTTP GET. Used by knossos.
    */
  def requestViaKnossos(
      datasetId: ObjectId,
      dataLayerName: String,
      mag: Int,
      x: Int,
      y: Int,
      z: Int,
      cubeSize: Int
  ): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (dataSource, dataLayer) <- datasetCache.getWithLayer(
          datasetId,
          dataLayerName
        ) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
        dataRequest = DataRequest(
          VoxelPosition(x * cubeSize * mag, y * cubeSize * mag, z * cubeSize * mag, Vec3Int(mag, mag, mag)),
          cubeSize,
          cubeSize,
          cubeSize
        )
        (data, emptyIndices, failureIndices) <- requestData(datasetId, dataSource.id, dataLayer, List(dataRequest))
      } yield Ok(data).withHeaders(createMissingBucketsHeaders(emptyIndices, failureIndices)*)
    }
  }

  def thumbnailJpeg(
      datasetId: ObjectId,
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
      invertColor: Option[Boolean]
  ): Action[RawBuffer] = Action.fox(parse.raw) { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        _ <- validateThumbnailDimensions(width, height)
        (dataSource, dataLayer) <- datasetCache.getWithLayer(
          datasetId,
          dataLayerName
        ) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
        magParsed <- Vec3Int.fromMagLiteral(mag).toFox ?~> Msg.Dataset.Mag.invalid(mag)
        dataRequest = DataRequest(
          VoxelPosition(x, y, z, magParsed),
          width,
          height,
          depth = 1,
          DataServiceRequestSettings(appliedAgglomerate = mappingName)
        )
        (data, _, _) <- requestData(datasetId, dataSource.id, dataLayer, List(dataRequest))
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
          isSegmentation = dataLayer.category == LayerCategory.segmentation,
          color = layerColor,
          invertColor = invertColor
        )
        dataWithFallback =
          if (data.length == 0)
            new Array[Byte](width * height * dataLayer.bytesPerElement)
          else data
        spriteSheet <- ImageCreator.spriteSheetFor(dataWithFallback, params).toFox ?~> Msg.Image.createFailed
        firstSheet <- spriteSheet.pages.headOption.toFox ?~> Msg.Image.pageFailed
        outputStream = new ByteArrayOutputStream()
        _ = new JPEGWriter().writeToOutputStream(firstSheet.image)(outputStream)
      } yield Ok(outputStream.toByteArray).as(jpegMimeType)
    }
  }

  private def combinedThumbnailLayerImage(
      datasetId: ObjectId,
      layerParams: CombinedThumbnailLayerParameters,
      outputWidth: Int,
      outputHeight: Int
  )(implicit ec: ExecutionContext, tc: TokenContext): Fox[(Boolean, BufferedImage)] =
    for {
      (dataSource, dataLayer) <- datasetCache.getWithLayer(
        datasetId,
        layerParams.dataLayerName
      ) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
      magParsed <- Vec3Int.fromMagLiteral(layerParams.mag).toFox ?~> Msg.Dataset.Mag.invalid(layerParams.mag)
      dataRequest = DataRequest(
        VoxelPosition(layerParams.x, layerParams.y, layerParams.z, magParsed),
        layerParams.width,
        layerParams.height,
        depth = 1,
        DataServiceRequestSettings(appliedAgglomerate = layerParams.mappingName)
      )
      (data, _, _) <- requestData(datasetId, dataSource.id, dataLayer, List(dataRequest))
      intensityRange: Option[(Double, Double)] = layerParams.intensityMin.flatMap(min =>
        layerParams.intensityMax.map(max => (min, max))
      )
      layerColor = layerParams.color.flatMap(Color.fromHTML)
      isSegmentation = dataLayer.category == LayerCategory.segmentation
      params = ImageCreatorParameters(
        dataLayer.elementClass,
        useHalfBytes = false,
        slideWidth = layerParams.width,
        slideHeight = layerParams.height,
        imagesPerRow = 1,
        blackAndWhite = false,
        intensityRange = intensityRange,
        isSegmentation = isSegmentation,
        color = layerColor,
        invertColor = layerParams.invertColor,
        preserveAlpha = true,
        opacity = layerParams.opacity
      )
      dataWithFallback =
        if (data.length == 0)
          new Array[Byte](layerParams.width * layerParams.height * dataLayer.bytesPerElement)
        else data
      spriteSheet <- ImageCreator.spriteSheetFor(dataWithFallback, params).toFox ?~> Msg.Image.createFailed
      firstSheet <- spriteSheet.pages.headOption.toFox ?~> Msg.Image.pageFailed
      image = firstSheet.image
    } yield {
      val resized =
        if (image.getWidth == outputWidth && image.getHeight == outputHeight) image
        else {
          val scaled = new BufferedImage(outputWidth, outputHeight, BufferedImage.TYPE_INT_ARGB)
          val graphics = scaled.createGraphics()
          graphics.drawImage(image, 0, 0, outputWidth, outputHeight, null)
          graphics.dispose()
          scaled
        }
      (isSegmentation, resized)
    }

  // Additively blends `colorImages` into one opaque base image (matching the frontend's default
  // "Additive" blend mode for color layers, viewer/constants.ts BLEND_MODES): channels are summed
  // (each layer's own opacity already baked into its per-pixel alpha) and clamped, rather than the
  // later layer opaquely overwriting the former the way normal alpha-over compositing would. Mirrors
  // blendLayersAdditive in frontend/javascripts/viewer/shaders/blending.glsl.ts (dest + src).
  private def blendColorLayersAdditively(colorImages: List[BufferedImage], width: Int, height: Int): BufferedImage = {
    val accum = new Array[Int](width * height)
    colorImages.foreach { image =>
      val pixels = image.getRGB(0, 0, width, height, null, 0, width)
      var i = 0
      while (i < pixels.length) {
        val argb = pixels(i)
        val alpha = (argb >>> 24) & 0xff
        val r = (argb >>> 16) & 0xff
        val g = (argb >>> 8) & 0xff
        val b = argb & 0xff
        val existing = accum(i)
        val newR = Math.min(255, ((existing >>> 16) & 0xff) + (r * alpha) / 255)
        val newG = Math.min(255, ((existing >>> 8) & 0xff) + (g * alpha) / 255)
        val newB = Math.min(255, (existing & 0xff) + (b * alpha) / 255)
        accum(i) = (0xff << 24) | (newR << 16) | (newG << 8) | newB
        i += 1
      }
    }
    val blended = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB)
    blended.setRGB(0, 0, width, height, accum, 0, width)
    blended
  }

  // Porter-Duff "over" compositing starting from a fully transparent base, matching blendLayersCover
  // (and, with blackAsTransparent, blendLayersCoverBlackAsTransparent) in
  // frontend/javascripts/viewer/shaders/blending.glsl.ts. Unlike additive blending, an earlier
  // fully-opaque layer is never overpainted by a later one.
  private def blendColorLayersCover(
      colorImages: List[BufferedImage],
      width: Int,
      height: Int,
      blackAsTransparent: Boolean
  ): BufferedImage = {
    val destR = new Array[Double](width * height)
    val destG = new Array[Double](width * height)
    val destB = new Array[Double](width * height)
    val destA = new Array[Double](width * height)
    colorImages.foreach { image =>
      val pixels = image.getRGB(0, 0, width, height, null, 0, width)
      var i = 0
      while (i < pixels.length) {
        val argb = pixels(i)
        val r = (argb >>> 16) & 0xff
        val g = (argb >>> 8) & 0xff
        val b = argb & 0xff
        val srcA =
          if (blackAsTransparent && r == 0 && g == 0 && b == 0) 0.0
          else ((argb >>> 24) & 0xff) / 255.0
        val dA = destA(i)
        val mixedAlphaFactor = (1.0 - dA) * srcA
        val mixedAlpha = mixedAlphaFactor + dA
        if (mixedAlpha > 0.0) {
          destR(i) = (dA * destR(i) + mixedAlphaFactor * r) / mixedAlpha
          destG(i) = (dA * destG(i) + mixedAlphaFactor * g) / mixedAlpha
          destB(i) = (dA * destB(i) + mixedAlphaFactor * b) / mixedAlpha
        }
        destA(i) = mixedAlpha
        i += 1
      }
    }
    val pixels = new Array[Int](width * height)
    var i = 0
    while (i < pixels.length) {
      pixels(i) = (0xff << 24) | (Math.round(destR(i)).toInt << 16) | (Math.round(destG(i)).toInt << 8) | Math
        .round(destB(i))
        .toInt
      i += 1
    }
    val blended = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB)
    blended.setRGB(0, 0, width, height, pixels, 0, width)
    blended
  }

  private def blendColorLayers(
      colorImages: List[BufferedImage],
      blendMode: String,
      width: Int,
      height: Int
  ): BufferedImage =
    blendMode match {
      case "Cover" => blendColorLayersCover(colorImages, width, height, blackAsTransparent = false)
      case "CoverWithBlackAsTransparent" =>
        blendColorLayersCover(colorImages, width, height, blackAsTransparent = true)
      case _ => blendColorLayersAdditively(colorImages, width, height)
    }

  def thumbnailCombinedJpeg(datasetId: ObjectId): Action[CombinedThumbnailRequest] =
    Action.fox(validateJson[CombinedThumbnailRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          _ <- validateThumbnailDimensions(request.body.width, request.body.height)
          _ <- Fox.serialCombined(request.body.layers)(layerParams =>
            validateThumbnailDimensions(layerParams.width, layerParams.height)
          )
          layerResults <- Fox.serialCombined(request.body.layers)(layerParams =>
            combinedThumbnailLayerImage(datasetId, layerParams, request.body.width, request.body.height)
          )
          colorImages = layerResults.collect { case (false, image) => image }
          segmentationImages = layerResults.collect { case (true, image) => image }
          // Color layers are combined per the dataset's configured blend mode (default Additive) into
          // one opaque base; segmentation layers are then alpha-blended on top (SRC_OVER, id 0 fully
          // transparent) regardless of blend mode, mirroring how the frontend mixes the segment tint
          // over the already-blended data color rather than folding it into the blend mode itself.
          composite = blendColorLayers(colorImages, request.body.blendMode, request.body.width, request.body.height)
          graphics = composite.createGraphics()
          _ = segmentationImages.foreach(image => graphics.drawImage(image, 0, 0, null))
          _ = graphics.dispose()
          outputStream = new ByteArrayOutputStream()
          _ = new JPEGWriter().writeToOutputStream(composite)(outputStream)
        } yield Ok(outputStream.toByteArray).as(jpegMimeType)
      }
    }

  def mappingJson(
      datasetId: ObjectId,
      dataLayerName: String,
      mappingName: String
  ): Action[AnyContent] = Action.fox { implicit request =>
    accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
      for {
        (dataSource, dataLayer) <- datasetCache.getWithLayer(
          datasetId,
          dataLayerName
        ) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
        segmentationLayer <- tryo(dataLayer.asInstanceOf[SegmentationLayer]).toFox ?~> Msg.Dataset.Layer
          .notFound(dataLayerName)
        mappingRequest = DataServiceMappingRequest(Some(dataSource.id), segmentationLayer, mappingName)
        result <- mappingService.loadMappingBytes(mappingRequest).toFox
      } yield Ok(result)
    }
  }

  /** Handles ad-hoc mesh requests.
    */
  def requestAdHocMesh(datasetId: ObjectId, dataLayerName: String): Action[WebknossosAdHocMeshRequest] =
    Action.fox(validateJson[WebknossosAdHocMeshRequest]) { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(
            datasetId,
            dataLayerName
          ) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
          segmentationLayer <- tryo(
            dataLayer.asInstanceOf[SegmentationLayer]
          ).toFox ?~> Msg.Dataset.Layer.mustBeSegmentation
          adHocMeshRequest = AdHocMeshRequest(
            Some(datasetId),
            Some(dataSource.id),
            segmentationLayer,
            request.body.cuboid,
            request.body.segmentId.toLong,
            request.body.voxelSizeFactorInUnit,
            tokenContextForRequest(using request),
            request.body.mapping,
            request.body.mappingType,
            request.body.additionalCoordinates,
            request.body.annotationVersion,
            request.body.findNeighbors
          )
          // The client expects the ad-hoc mesh as a flat float-array. Three consecutive floats form a 3D point, three
          // consecutive 3D points (i.e., nine floats) form a triangle.
          // There are no shared vertices between triangles.
          (vertices, neighbors) <- adHocMeshService.requestAdHocMeshViaActor(adHocMeshRequest)
        } yield {
          // We need four bytes for each float
          val responseBuffer = ByteBuffer.allocate(vertices.length * 4).order(ByteOrder.LITTLE_ENDIAN)
          responseBuffer.asFloatBuffer().put(vertices)
          Ok(responseBuffer.array()).withHeaders(getNeighborIndices(neighbors)*)
        }
      }
    }

  private def getNeighborIndices(neighbors: List[Int]) =
    List("NEIGHBORS" -> formatNeighborList(neighbors), "Access-Control-Expose-Headers" -> "NEIGHBORS")

  private def formatNeighborList(neighbors: List[Int]): String =
    "[" + neighbors.mkString(", ") + "]"

  def findData(datasetId: ObjectId, dataLayerName: String): Action[AnyContent] =
    Action.fox { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(
            datasetId,
            dataLayerName
          ) ?~> Msg.Dataset.DataSource.notFound ~> NOT_FOUND
          positionAndMagOpt <- findDataService.findPositionWithData(datasetId, dataSource.id, dataLayer)
        } yield Ok(Json.obj("position" -> positionAndMagOpt.map(_._1), "mag" -> positionAndMagOpt.map(_._2)))
      }
    }

  def histogram(datasetId: ObjectId, dataLayerName: String): Action[AnyContent] =
    Action.fox { implicit request =>
      accessTokenService.validateAccessFromTokenContext(UserAccessRequest.readDataset(datasetId)) {
        for {
          (dataSource, dataLayer) <- datasetCache.getWithLayer(datasetId, dataLayerName) ?~> Msg.Dataset.Histogram
            .layerMissing(dataLayerName) ~> NOT_FOUND
          histograms <- findDataService.createHistogram(datasetId, dataSource.id, dataLayer) ?~> Msg.Dataset.Histogram
            .failed(dataLayerName)
        } yield Ok(Json.toJson(histograms))
      }
    }

  private def requestData(
      datasetId: ObjectId,
      dataSourceId: DataSourceId,
      dataLayer: DataLayer,
      dataRequests: List[AbstractDataRequest]
  )(using tc: TokenContext): Fox[(Array[Byte], Seq[Int], Seq[Int])] = {
    val requests =
      dataRequests.map(r =>
        DataServiceDataRequest(Some(datasetId), Some(dataSourceId), dataLayer, r.cuboid(dataLayer), r.settings)
      )
    binaryDataService.handleDataRequests(requests)
  }

}
