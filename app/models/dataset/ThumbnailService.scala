package models.dataset
import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.box.Full
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.image.Color
import com.scalableminds.util.mvc.MimeTypes
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, JsonHelper, MathUtils}
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.controllers.{CombinedThumbnailLayerParameters, CombinedThumbnailRequest}
import com.scalableminds.webknossos.datastore.models.datasource.DatasetViewConfiguration.DatasetViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.{LayerCategory, StaticLayer, UsableDataSource}
import com.typesafe.scalalogging.LazyLogging
import models.configuration.DatasetConfigurationService
import play.api.http.Status.NOT_FOUND
import com.scalableminds.util.objectid.ObjectId
import play.api.libs.json.{JsArray, JsObject}
import utils.sql.{SimpleSQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.*

class ThumbnailService @Inject() (
    datasetService: DatasetService,
    thumbnailCachingService: ThumbnailCachingService,
    datasetConfigurationService: DatasetConfigurationService,
    datasetDAO: DatasetDAO,
    thumbnailDAO: ThumbnailDAO
) extends LazyLogging
    with MimeTypes {

  private val DefaultThumbnailWidth = 400
  private val DefaultThumbnailHeight = 400
  private val MaxThumbnailWidth = 4000
  private val MaxThumbnailHeight = 4000

  // Sentinel dataLayerName for the whole-dataset combined thumbnail, reusing the per-layer thumbnail
  // cache table. Safe because real layer names are never empty.
  private val CombinedThumbnailLayerNameSentinel = ""

  def getThumbnailWithCache(
      datasetIdValidated: ObjectId,
      layerName: String,
      w: Option[Int],
      h: Option[Int],
      mappingName: Option[String]
  )(implicit ec: ExecutionContext): Fox[Array[Byte]] = {
    val width = MathUtils.clamp(w.getOrElse(DefaultThumbnailWidth), 1, MaxThumbnailWidth)
    val height =
      MathUtils.clamp(h.getOrElse(DefaultThumbnailHeight), 1, MaxThumbnailHeight)
    for {
      dataset <- datasetDAO.findOne(datasetIdValidated)(using GlobalAccessContext)
      image <- thumbnailCachingService.getOrLoad(
        dataset._id,
        layerName,
        width,
        height,
        mappingName,
        _ => getThumbnail(dataset, layerName, width, height, mappingName)(using ec, GlobalAccessContext)
      )
    } yield image
  }

  private def getThumbnail(dataset: Dataset, layerName: String, width: Int, height: Int, mappingName: Option[String])(
      implicit
      ec: ExecutionContext,
      ctx: DBAccessContext
  ): Fox[Array[Byte]] =
    for {
      usableDataSource <- datasetService.usableDataSourceFor(dataset)
      layer <- usableDataSource.dataLayers.find(_.name == layerName).toFox ?~> Msg.Dataset.Layer
        .notFound(layerName) ~> NOT_FOUND
      viewConfiguration <- datasetConfigurationService.getDatasetViewConfigurationForDataset(List.empty, dataset._id)(
        using ctx
      )
      (mag1BoundingBox, mag, intensityRangeOpt, colorSettingsOpt, mapping) = selectParameters(
        viewConfiguration,
        usableDataSource,
        layerName,
        layer,
        width,
        height,
        mappingName
      )
      client <- datasetService.clientFor(dataset)
      image <- client.getDataLayerThumbnail(
        dataset,
        layerName,
        mag1BoundingBox,
        mag,
        mapping,
        intensityRangeOpt,
        colorSettingsOpt
      )
      _ <- thumbnailDAO.upsertThumbnail(
        dataset._id,
        layerName,
        width,
        height,
        mapping,
        image,
        jpegMimeType,
        mag,
        mag1BoundingBox
      )
    } yield image

  def getDatasetThumbnailWithCache(
      datasetIdValidated: ObjectId,
      w: Option[Int],
      h: Option[Int]
  )(implicit ec: ExecutionContext): Fox[Array[Byte]] = {
    val width = MathUtils.clamp(w.getOrElse(DefaultThumbnailWidth), 1, MaxThumbnailWidth)
    val height = MathUtils.clamp(h.getOrElse(DefaultThumbnailHeight), 1, MaxThumbnailHeight)
    for {
      dataset <- datasetDAO.findOne(datasetIdValidated)(using GlobalAccessContext)
      image <- thumbnailCachingService.getOrLoad(
        dataset._id,
        CombinedThumbnailLayerNameSentinel,
        width,
        height,
        None,
        _ => getDatasetThumbnail(dataset, width, height)(using ec, GlobalAccessContext)
      )
    } yield image
  }

  private def getDatasetThumbnail(dataset: Dataset, width: Int, height: Int)(implicit
      ec: ExecutionContext,
      ctx: DBAccessContext
  ): Fox[Array[Byte]] =
    for {
      usableDataSource <- datasetService.usableDataSourceFor(dataset)
      firstLayer <- usableDataSource.dataLayers.headOption.toFox ?~> "dataset.noLayers" ~> NOT_FOUND
      viewConfiguration <- datasetConfigurationService.getDatasetViewConfigurationForDataset(List.empty, dataset._id)(
        using ctx
      )
      layersToRender = selectLayersToRender(viewConfiguration, usableDataSource)
      hasColorLayers = layersToRender.exists(_.category == LayerCategory.color)
      blendMode = readBlendMode(viewConfiguration)
      (center, zoom) = selectCenterAndZoom(viewConfiguration, usableDataSource, firstLayer)
      // Physical (mag1) extent of the thumbnail, shared by every layer so they all show the same
      // field of view. Must NOT be derived from any individual layer's chosen mag: layers can have
      // mismatched mag pyramids (e.g. a segmentation layer with no mag 1), which would otherwise make
      // that layer cover a different physical area than the others for the same output pixel size.
      mag1Width = Math.round(width * zoom).toInt
      mag1Height = Math.round(height * zoom).toInt
      layerParameters = layersToRender.map(layer =>
        selectCombinedThumbnailLayerParameters(
          viewConfiguration,
          layer,
          center,
          zoom,
          mag1Width,
          mag1Height,
          width,
          height,
          hasColorLayers
        )
      )
      client <- datasetService.clientFor(dataset)
      image <- client.getCombinedThumbnail(
        dataset,
        CombinedThumbnailRequest(width, height, layerParameters, blendMode)
      )
      _ <- thumbnailDAO.upsertThumbnail(
        dataset._id,
        CombinedThumbnailLayerNameSentinel,
        width,
        height,
        None,
        image,
        jpegMimeType,
        // The rendered layers may each use their own mag; this is stored only for debugging purposes.
        Vec3Int(1, 1, 1),
        BoundingBox(center, width, height, 1)
      )
    } yield image

  private def selectCenterAndZoom(
      viewConfiguration: DatasetViewConfiguration,
      usableDataSource: UsableDataSource,
      fallbackCenterLayer: StaticLayer
  ): (Vec3Int, Double) = {
    val configuredCenterOpt =
      viewConfiguration.get("position").flatMap(jsValue => JsonHelper.as[Vec3Int](jsValue).toOption)
    val centerOpt =
      configuredCenterOpt.orElse(BoundingBox.intersection(usableDataSource.dataLayers.map(_.boundingBox)).map(_.center))
    val center = centerOpt.getOrElse(fallbackCenterLayer.boundingBox.center)
    val zoom = viewConfiguration.get("zoom").flatMap(jsValue => JsonHelper.as[Double](jsValue).toOption).getOrElse(1.0)
    (center, zoom)
  }

  private def selectParameters(
      viewConfiguration: DatasetViewConfiguration,
      usableDataSource: UsableDataSource,
      layerName: String,
      layer: StaticLayer,
      targetMagWidth: Int,
      targetMagHeigt: Int,
      mappingName: Option[String]
  ): (BoundingBox, Vec3Int, Option[(Double, Double)], Option[ThumbnailColorSettings], Option[String]) = {
    val (center, zoom) = selectCenterAndZoom(viewConfiguration, usableDataSource, layer)
    val intensityRangeOpt = readIntensityRange(viewConfiguration, layerName)
    val colorSettingsOpt = readColor(viewConfiguration, layerName)
    val mag = magForZoom(layer, zoom)
    val mag1Width = targetMagWidth * mag.x
    val mag1Height = targetMagHeigt * mag.y
    val x = center.x - mag1Width / 2
    val y = center.y - mag1Height / 2
    val z = center.z

    val mappingNameResult = mappingName.orElse(readMappingName(viewConfiguration, layerName))
    (
      BoundingBox(Vec3Int(x, y, z), mag1Width, mag1Height, 1),
      mag,
      intensityRangeOpt,
      colorSettingsOpt,
      mappingNameResult
    )
  }

  private def selectCombinedThumbnailLayerParameters(
      viewConfiguration: DatasetViewConfiguration,
      layer: StaticLayer,
      center: Vec3Int,
      zoom: Double,
      mag1Width: Int,
      mag1Height: Int,
      outputWidth: Int,
      outputHeight: Int,
      hasColorLayers: Boolean
  ): CombinedThumbnailLayerParameters = {
    val isSegmentation = layer.category == LayerCategory.segmentation
    val intensityRangeOpt = readIntensityRange(viewConfiguration, layer.name)
    val colorSettingsOpt = readColor(viewConfiguration, layer.name)
    val mappingNameOpt = readMappingName(viewConfiguration, layer.name)
    val opacity = readOpacity(viewConfiguration, layer.name, isSegmentation, hasColorLayers)
    // Each layer may pick a different native mag (e.g. if it lacks a mag the other layers have), but
    // mag1Width/mag1Height (the physical area covered) are fixed and shared across all layers, so the
    // target-mag voxel counts fetched here differ instead. The datastore resizes the result to
    // (outputWidth, outputHeight) before compositing, so this stays pixel-aligned across layers.
    val mag = magForZoom(layer, zoom)
    val targetMagWidth = math.max(1, mag1Width / mag.x)
    val targetMagHeight = math.max(1, mag1Height / mag.y)
    CombinedThumbnailLayerParameters(
      dataLayerName = layer.name,
      x = center.x - mag1Width / 2,
      y = center.y - mag1Height / 2,
      z = center.z,
      mag = mag.toMagLiteral(allowScalar = false),
      width = targetMagWidth,
      height = targetMagHeight,
      mappingName = mappingNameOpt,
      intensityMin = intensityRangeOpt.map(_._1),
      intensityMax = intensityRangeOpt.map(_._2),
      color = colorSettingsOpt.map(_.color.toHtml),
      invertColor = colorSettingsOpt.map(_.isInverted),
      opacity = opacity
    )
  }

  private def selectLayersToRender(
      viewConfiguration: DatasetViewConfiguration,
      usableDataSource: UsableDataSource
  ): List[StaticLayer] = {
    def isEnabled(layer: StaticLayer): Boolean = !readIsDisabled(viewConfiguration, layer.name)

    val colorLayerOrder = readColorLayerOrder(viewConfiguration)
    val orderedColorLayers =
      usableDataSource.dataLayers.filter(layer => layer.category == LayerCategory.color && isEnabled(layer)).sortBy {
        layer =>
          val index = colorLayerOrder.indexOf(layer.name)
          if (index == -1) Int.MaxValue else index
      }

    val segmentationLayerOpt = usableDataSource.dataLayers
      .filter(layer => layer.category == LayerCategory.segmentation && isEnabled(layer))
      .sortBy(_.name)
      .headOption

    val layersToRender = orderedColorLayers ++ segmentationLayerOpt.toList
    if (layersToRender.nonEmpty) layersToRender else usableDataSource.dataLayers
  }

  private def readIntensityRange(
      viewConfiguration: DatasetViewConfiguration,
      layerName: String
  ): Option[(Double, Double)] =
    for {
      layersJsValue <- viewConfiguration.get("layers")
      intensityRangeJsArray <- (layersJsValue \ layerName \ "intensityRange").asOpt[JsArray]
      min <- (intensityRangeJsArray \ 0).asOpt[Double]
      max <- (intensityRangeJsArray \ 1).asOpt[Double]
    } yield (min, max)

  private def readColor(
      viewConfiguration: DatasetViewConfiguration,
      layerName: String
  ): Option[ThumbnailColorSettings] =
    for {
      layersJsValue <- viewConfiguration.get("layers")
      colorArray <- (layersJsValue \ layerName \ "color").asOpt[JsArray]
      isInverted = (layersJsValue \ layerName \ "isInverted").asOpt[Boolean].getOrElse(false)
      r <- colorArray(0).validate[Int].asOpt
      g <- colorArray(1).validate[Int].asOpt
      b <- colorArray(2).validate[Int].asOpt
    } yield ThumbnailColorSettings(Color(r / 255d, g / 255d, b / 255d, 0), isInverted)

  private def readMappingName(viewConfiguration: DatasetViewConfiguration, layerName: String): Option[String] =
    for {
      layersJsValue <- viewConfiguration.get("layers")
      mapping <- (layersJsValue \ layerName \ "mapping").validate[JsObject].asOpt
      mappingName <- mapping("name").validate[String].asOpt
    } yield mappingName

  private def magForZoom(dataLayer: StaticLayer, zoom: Double): Vec3Int =
    dataLayer.resolutions.minBy(r => Math.abs(r.maxDim - zoom))

  private val DefaultColorLayerOpacity = 100d
  private val DefaultSegmentationLayerOpacity = 20d
  // Used instead when the thumbnail has no color layers to composite the segmentation on top of, since
  // 20% opacity against a plain black background is too faint to make out.
  private val DefaultSegmentationLayerOpacityWithoutColorLayers = 60d

  private def readOpacity(
      viewConfiguration: DatasetViewConfiguration,
      layerName: String,
      isSegmentation: Boolean,
      hasColorLayers: Boolean
  ): Double = {
    val default =
      if (!isSegmentation) DefaultColorLayerOpacity
      else if (hasColorLayers) DefaultSegmentationLayerOpacity
      else DefaultSegmentationLayerOpacityWithoutColorLayers
    (for {
      layersJsValue <- viewConfiguration.get("layers")
      alpha <- (layersJsValue \ layerName \ "alpha").asOpt[Double]
    } yield alpha).getOrElse(default)
  }

  private def readIsDisabled(viewConfiguration: DatasetViewConfiguration, layerName: String): Boolean =
    (for {
      layersJsValue <- viewConfiguration.get("layers")
      isDisabled <- (layersJsValue \ layerName \ "isDisabled").asOpt[Boolean]
    } yield isDisabled).getOrElse(false)

  private def readColorLayerOrder(viewConfiguration: DatasetViewConfiguration): List[String] =
    viewConfiguration
      .get("colorLayerOrder")
      .flatMap(jsValue => JsonHelper.as[List[String]](jsValue).toOption)
      .getOrElse(List.empty)

  // Dataset-wide setting (sibling of "layers", not per-layer), matching the frontend's
  // DatasetConfiguration.blendMode default of BLEND_MODES.Additive.
  private def readBlendMode(viewConfiguration: DatasetViewConfiguration): String =
    viewConfiguration.get("blendMode").flatMap(_.asOpt[String]).getOrElse("Additive")

}

case class ThumbnailColorSettings(color: Color, isInverted: Boolean)

class ThumbnailCachingService @Inject() (thumbnailDAO: ThumbnailDAO, datasetDAO: DatasetDAO) {
  private val ThumbnailCacheDuration = 10 days

  // First cache is in memory, then in postgres.
  // Key: datasetId, layerName, width, height, mappingName
  private lazy val inMemoryThumbnailCache: AlfuCache[(ObjectId, String, Int, Int, Option[String]), Array[Byte]] =
    AlfuCache(maxCapacity = 100, timeToLive = ThumbnailCacheDuration)

  def getOrLoad(
      datasetId: ObjectId,
      layerName: String,
      width: Int,
      height: Int,
      mappingName: Option[String],
      loadFn: Unit => Fox[Array[Byte]]
  )(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    inMemoryThumbnailCache.getOrLoad(
      (datasetId, layerName, width, height, mappingName),
      _ =>
        for {
          fromDbBox <- thumbnailDAO.findOne(datasetId, layerName, width, height, mappingName).shiftBox
          fromDbOrNew <- fromDbBox match {
            case Full(fromDb) =>
              Fox.successful(fromDb)
            case _ =>
              loadFn(())
          }
        } yield fromDbOrNew
    )

  def removeFromCache(datasetId: ObjectId): Fox[Unit] = {
    inMemoryThumbnailCache.clear(keyTuple => keyTuple._1 == datasetId)
    for {
      _ <- thumbnailDAO.removeAllForDataset(datasetId)
      _ <- datasetDAO.incrementThumbnailCacheVersion(datasetId)
    } yield ()
  }

  def removeExpiredThumbnails(): Fox[Unit] = thumbnailDAO.removeAllExpired(ThumbnailCacheDuration)
}

class ThumbnailDAO @Inject() (SQLClient: SqlClient)(implicit ec: ExecutionContext) extends SimpleSQLDAO(SQLClient) {

  def findOne(
      datasetId: ObjectId,
      layerName: String,
      width: Int,
      height: Int,
      mappingNameOpt: Option[String]
  ): Fox[Array[Byte]] = {
    val mappingName = mappingNameOpt.getOrElse("")
    for {
      rows <- run(q"""SELECT image
                     FROM webknossos.dataset_thumbnails
                     WHERE _dataset = $datasetId
                     AND dataLayerName = $layerName
                     AND width = $width
                     AND height = $height
                     AND mappingName = $mappingName""".as[Array[Byte]])
      head <- rows.headOption.toFox
    } yield head
  }

  def upsertThumbnail(
      datasetId: ObjectId,
      layerName: String,
      width: Int,
      height: Int,
      mappingNameOpt: Option[String],
      image: Array[Byte],
      mimeType: String,
      mag: Vec3Int,
      mag1BoundingBox: BoundingBox
  ): Fox[Unit] = {
    val mappingName = mappingNameOpt.getOrElse(
      ""
    ) // in sql, nullable columns can’t be primary key, so we encode no mapping with empty string
    for {
      _ <- run(q"""INSERT INTO webknossos.dataset_thumbnails (
            _dataset, dataLayerName, width, height, mappingName, image, mimetype, mag, mag1BoundingBox, created)
                   VALUES($datasetId, $layerName, $width, $height, $mappingName, $image, $mimeType, $mag, $mag1BoundingBox, ${Instant.now})
                   ON CONFLICT (_dataset, dataLayerName, width, height, mappingName)
                   DO UPDATE SET
                     image = $image,
                     mimeType = $mimeType,
                     mag = $mag,
                     mag1BoundingBox = $mag1BoundingBox,
                     created = ${Instant.now}
    """.asUpdate)
    } yield ()
  }

  def removeAllForDataset(datasetId: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"DELETE FROM webknossos.dataset_thumbnails WHERE _dataset = $datasetId".asUpdate)
    } yield ()

  def removeAllExpired(expiryDuration: FiniteDuration): Fox[Unit] =
    for {
      num <- run(q"DELETE FROM webknossos.dataset_thumbnails WHERE created < ${Instant.now - expiryDuration}".asUpdate)
      _ = logger.info(s"removed $num expired thumbnails")
    } yield ()
}
