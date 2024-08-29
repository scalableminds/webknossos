package models.dataset
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.image.Color
import com.scalableminds.util.mvc.MimeTypes
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox.option2Fox
import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.webknossos.datastore.models.datasource.DatasetViewConfiguration.DatasetViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayerLike, GenericDataSource}
import com.typesafe.scalalogging.LazyLogging
import models.configuration.DatasetConfigurationService
import net.liftweb.common.Full
import play.api.http.Status.NOT_FOUND
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.JsArray
import utils.ObjectId
import utils.sql.{SimpleSQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class ThumbnailService @Inject()(datasetService: DatasetService,
                                 thumbnailCachingService: ThumbnailCachingService,
                                 datasetConfigurationService: DatasetConfigurationService,
                                 datasetDAO: DatasetDAO,
                                 thumbnailDAO: ThumbnailDAO)
    extends LazyLogging
    with MimeTypes {

  private val DefaultThumbnailWidth = 400
  private val DefaultThumbnailHeight = 400
  private val MaxThumbnailWidth = 4000
  private val MaxThumbnailHeight = 4000

  def getThumbnailWithCache(
      organizationId: String,
      datasetName: String,
      layerName: String,
      w: Option[Int],
      h: Option[Int],
      mappingName: Option[String])(implicit ec: ExecutionContext, mp: MessagesProvider): Fox[Array[Byte]] = {
    val width = com.scalableminds.util.tools.Math.clamp(w.getOrElse(DefaultThumbnailWidth), 1, MaxThumbnailWidth)
    val height = com.scalableminds.util.tools.Math.clamp(h.getOrElse(DefaultThumbnailHeight), 1, MaxThumbnailHeight)
    for {
      dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, organizationId)(GlobalAccessContext)
      image <- thumbnailCachingService.getOrLoad(
        dataset._id,
        layerName,
        width,
        height,
        mappingName,
        _ =>
          getThumbnail(organizationId, datasetName, layerName, width, height, mappingName)(ec, GlobalAccessContext, mp)
      )
    } yield image
  }

  private def getThumbnail(organizationId: String,
                           datasetName: String,
                           layerName: String,
                           width: Int,
                           height: Int,
                           mappingName: Option[String])(implicit ec: ExecutionContext,
                                                        ctx: DBAccessContext,
                                                        mp: MessagesProvider): Fox[Array[Byte]] =
    for {
      dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, organizationId)
      dataSource <- datasetService.dataSourceFor(dataset) ?~> "dataSource.notFound" ~> NOT_FOUND
      usableDataSource <- dataSource.toUsable.toFox ?~> "dataset.notImported"
      layer <- usableDataSource.dataLayers.find(_.name == layerName) ?~> Messages("dataLayer.notFound", layerName) ~> NOT_FOUND
      viewConfiguration <- datasetConfigurationService.getDatasetViewConfigurationForDataset(List.empty,
                                                                                             datasetName,
                                                                                             organizationId)(ctx)
      (mag1BoundingBox, mag, intensityRangeOpt, colorSettingsOpt) = selectParameters(viewConfiguration,
                                                                                     usableDataSource,
                                                                                     layerName,
                                                                                     layer,
                                                                                     width,
                                                                                     height)
      client <- datasetService.clientFor(dataset)
      image <- client.getDataLayerThumbnail(organizationId,
                                            dataset,
                                            layerName,
                                            mag1BoundingBox,
                                            mag,
                                            mappingName,
                                            intensityRangeOpt,
                                            colorSettingsOpt)
      _ <- thumbnailDAO.upsertThumbnail(dataset._id,
                                        layerName,
                                        width,
                                        height,
                                        mappingName,
                                        image,
                                        jpegMimeType,
                                        mag,
                                        mag1BoundingBox)
    } yield image

  private def selectParameters(
      viewConfiguration: DatasetViewConfiguration,
      usableDataSource: GenericDataSource[DataLayerLike],
      layerName: String,
      layer: DataLayerLike,
      targetMagWidth: Int,
      targetMagHeigt: Int): (BoundingBox, Vec3Int, Option[(Double, Double)], Option[ThumbnailColorSettings]) = {
    val configuredCenterOpt =
      viewConfiguration.get("position").flatMap(jsValue => JsonHelper.jsResultToOpt(jsValue.validate[Vec3Int]))
    val centerOpt =
      configuredCenterOpt.orElse(BoundingBox.intersection(usableDataSource.dataLayers.map(_.boundingBox)).map(_.center))
    val center = centerOpt.getOrElse(layer.boundingBox.center)
    val zoom = viewConfiguration
      .get("zoom")
      .flatMap(jsValue => JsonHelper.jsResultToOpt(jsValue.validate[Double]))
      .getOrElse(1.0)
    val intensityRangeOpt = readIntensityRange(viewConfiguration, layerName)
    val colorSettingsOpt = readColor(viewConfiguration, layerName)
    val mag = magForZoom(layer, zoom)
    val mag1Width = targetMagWidth * mag.x
    val mag1Height = targetMagHeigt * mag.y
    val x = center.x - mag1Width / 2
    val y = center.y - mag1Height / 2
    val z = center.z
    (BoundingBox(Vec3Int(x, y, z), mag1Width, mag1Height, 1), mag, intensityRangeOpt, colorSettingsOpt)
  }

  private def readIntensityRange(viewConfiguration: DatasetViewConfiguration,
                                 layerName: String): Option[(Double, Double)] =
    for {
      layersJsValue <- viewConfiguration.get("layers")
      intensityRangeJsArray <- (layersJsValue \ layerName \ "intensityRange").asOpt[JsArray]
      min <- (intensityRangeJsArray \ 0).asOpt[Double]
      max <- (intensityRangeJsArray \ 1).asOpt[Double]
    } yield (min, max)

  private def readColor(viewConfiguration: DatasetViewConfiguration,
                        layerName: String): Option[ThumbnailColorSettings] =
    for {
      layersJsValue <- viewConfiguration.get("layers")
      colorArray <- (layersJsValue \ layerName \ "color").asOpt[JsArray]
      isInverted = (layersJsValue \ layerName \ "isInverted").asOpt[Boolean].getOrElse(false)
      r <- colorArray(0).validate[Int].asOpt
      g <- colorArray(1).validate[Int].asOpt
      b <- colorArray(2).validate[Int].asOpt
    } yield ThumbnailColorSettings(Color(r / 255d, g / 255d, b / 255d, 0), isInverted)

  private def magForZoom(dataLayer: DataLayerLike, zoom: Double): Vec3Int =
    dataLayer.resolutions.minBy(r => Math.abs(r.maxDim - zoom))

}

case class ThumbnailColorSettings(color: Color, isInverted: Boolean)

class ThumbnailCachingService @Inject()(datasetDAO: DatasetDAO, thumbnailDAO: ThumbnailDAO) {
  private val ThumbnailCacheDuration = 10 days

  // First cache is in memory, then in postgres.
  // Key: datasetId, layerName, width, height, mappingName
  private lazy val inMemoryThumbnailCache: AlfuCache[(ObjectId, String, Int, Int, Option[String]), Array[Byte]] =
    AlfuCache(maxCapacity = 100, timeToLive = ThumbnailCacheDuration)

  def getOrLoad(datasetId: ObjectId,
                layerName: String,
                width: Int,
                height: Int,
                mappingName: Option[String],
                loadFn: Unit => Fox[Array[Byte]])(implicit ec: ExecutionContext): Fox[Array[Byte]] =
    inMemoryThumbnailCache.getOrLoad(
      (datasetId, layerName, width, height, mappingName),
      _ =>
        for {
          fromDbBox <- thumbnailDAO.findOne(datasetId, layerName, width, height, mappingName).futureBox
          fromDbOrNew <- fromDbBox match {
            case Full(fromDb) =>
              Fox.successful(fromDb)
            case _ =>
              loadFn(())
          }
        } yield fromDbOrNew
    )

  def removeFromCache(organizationId: String, datasetName: String): Fox[Unit] =
    for {
      dataset <- datasetDAO.findOneByNameAndOrganization(datasetName, organizationId)(GlobalAccessContext)
      _ <- removeFromCache(dataset._id)
    } yield ()

  def removeFromCache(datasetId: ObjectId): Fox[Unit] = {
    inMemoryThumbnailCache.clear(keyTuple => keyTuple._1 == datasetId)
    thumbnailDAO.removeAllForDataset(datasetId)
  }

  def removeExpiredThumbnails(): Fox[Unit] = thumbnailDAO.removeAllExpired(ThumbnailCacheDuration)
}

class ThumbnailDAO @Inject()(SQLClient: SqlClient)(implicit ec: ExecutionContext) extends SimpleSQLDAO(SQLClient) {

  def findOne(datasetId: ObjectId,
              layerName: String,
              width: Int,
              height: Int,
              mappingNameOpt: Option[String]): Fox[Array[Byte]] = {
    val mappingName = mappingNameOpt.getOrElse("")
    for {
      rows <- run(q"""SELECT image
                     FROM webknossos.dataset_thumbnails
                     WHERE _dataset = $datasetId
                     AND dataLayerName = $layerName
                     AND width = $width
                     AND height = $height
                     AND mappingName = $mappingName""".as[Array[Byte]])
      head <- rows.headOption
    } yield head
  }

  def upsertThumbnail(datasetId: ObjectId,
                      layerName: String,
                      width: Int,
                      height: Int,
                      mappingNameOpt: Option[String],
                      image: Array[Byte],
                      mimeType: String,
                      mag: Vec3Int,
                      mag1BoundingBox: BoundingBox): Fox[Unit] = {
    val mappingName = mappingNameOpt.getOrElse("") // in sql, nullable columns can’t be primary key, so we encode no mapping with emptystring
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
