package models.binary
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox.option2Fox
import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.webknossos.datastore.models.datasource.DataSetViewConfiguration.DataSetViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayerLike, GenericDataSource}
import com.typesafe.scalalogging.LazyLogging
import models.configuration.DataSetConfigurationService
import net.liftweb.common.Full
import play.api.http.Status.NOT_FOUND
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{JsArray, JsObject}
import utils.ObjectId
import utils.sql.{SimpleSQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class ThumbnailService @Inject()(dataSetService: DataSetService,
                                 thumbnailCachingService: ThumbnailCachingService,
                                 dataSetConfigurationService: DataSetConfigurationService,
                                 dataSetDAO: DataSetDAO,
                                 thumbnailDAO: ThumbnailDAO)
    extends LazyLogging {

  private val DefaultThumbnailWidth = 400
  private val DefaultThumbnailHeight = 400
  private val MaxThumbnailWidth = 4000
  private val MaxThumbnailHeight = 4000

  def getThumbnailWithCache(
      organizationName: String,
      datasetName: String,
      layerName: String,
      w: Option[Int],
      h: Option[Int],
      mappingName: Option[String])(implicit ec: ExecutionContext, mp: MessagesProvider): Fox[Array[Byte]] = {
    val width = com.scalableminds.util.tools.Math.clamp(w.getOrElse(DefaultThumbnailWidth), 1, MaxThumbnailWidth)
    val height = com.scalableminds.util.tools.Math.clamp(h.getOrElse(DefaultThumbnailHeight), 1, MaxThumbnailHeight)
    for {
      dataset <- dataSetDAO.findOneByNameAndOrganizationName(datasetName, organizationName)(GlobalAccessContext)
      image <- thumbnailCachingService.getOrLoad(
        dataset._id,
        layerName,
        width,
        height,
        mappingName,
        _ =>
          getThumbnail(organizationName, datasetName, layerName, width, height, mappingName)(ec,
                                                                                             GlobalAccessContext,
                                                                                             mp)
      )
    } yield image
  }

  private def getThumbnail(organizationName: String,
                           datasetName: String,
                           layerName: String,
                           width: Int,
                           height: Int,
                           mappingName: Option[String])(implicit ec: ExecutionContext,
                                                        ctx: DBAccessContext,
                                                        mp: MessagesProvider): Fox[Array[Byte]] =
    for {
      dataset <- dataSetDAO.findOneByNameAndOrganizationName(datasetName, organizationName)
      dataSource <- dataSetService.dataSourceFor(dataset) ?~> "dataSource.notFound" ~> NOT_FOUND
      usableDataSource <- dataSource.toUsable.toFox ?~> "dataSet.notImported"
      layer <- usableDataSource.dataLayers.find(_.name == layerName) ?~> Messages("dataLayer.notFound", layerName) ~> NOT_FOUND
      viewConfiguration <- dataSetConfigurationService.getDataSetViewConfigurationForDataset(List.empty,
                                                                                             datasetName,
                                                                                             organizationName)(ctx)
      (mag1BoundingBox, mag, intensityRangeOpt) = selectParameters(viewConfiguration,
                                                                   usableDataSource,
                                                                   layerName,
                                                                   layer,
                                                                   width,
                                                                   height)
      client <- dataSetService.clientFor(dataset)
      image <- client.getDataLayerThumbnail(organizationName,
                                            dataset,
                                            layerName,
                                            mag1BoundingBox,
                                            mag,
                                            mappingName,
                                            intensityRangeOpt)
      _ <- thumbnailDAO.upsertThumbnail(dataset._id, layerName, width, height, mappingName, image)
    } yield image

  private def selectParameters(viewConfiguration: DataSetViewConfiguration,
                               usableDataSource: GenericDataSource[DataLayerLike],
                               layerName: String,
                               layer: DataLayerLike,
                               width: Int,
                               height: Int): (BoundingBox, Vec3Int, Option[(Double, Double)]) = {
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
    val mag = magForZoom(layer, zoom)
    val x = Math.max(0, center.x - width * mag.x / 2)
    val y = Math.max(0, center.y - height * mag.y / 2)
    val z = center.z
    (BoundingBox(Vec3Int(x, y, z), width, height, 1), mag, intensityRangeOpt)
  }

  private def readIntensityRange(viewConfiguration: DataSetViewConfiguration,
                                 layerName: String): Option[(Double, Double)] =
    for {
      layersJsValue <- viewConfiguration.get("layers")
      intensityRangeJsArray <- (layersJsValue \ layerName \ "intensityRange").asOpt[JsArray]
      min <- (intensityRangeJsArray \ 0).asOpt[Double]
      max <- (intensityRangeJsArray \ 1).asOpt[Double]
    } yield (min, max)

  private def magForZoom(dataLayer: DataLayerLike, zoom: Double): Vec3Int =
    dataLayer.resolutions.minBy(r => Math.abs(r.maxDim - zoom))

}

class ThumbnailCachingService @Inject()(dataSetDAO: DataSetDAO, thumbnailDAO: ThumbnailDAO) {
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

  def removeFromCache(organizationName: String, datasetName: String): Fox[Unit] =
    for {
      dataset <- dataSetDAO.findOneByNameAndOrganizationName(datasetName, organizationName)(GlobalAccessContext)
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
              mappingName: Option[String]): Fox[Array[Byte]] =
    for {
      rows <- run(q"""SELECT image
           FROM webknossos.dataSet_thumbnails
           WHERE _dataSet = $datasetId
           AND dataLayerName = $layerName
           AND width = $width
           AND height = $height
           AND mappingName = $mappingName""".as[Array[Byte]])
      head <- rows.headOption
    } yield head

  def upsertThumbnail(datasetId: ObjectId,
                      layerName: String,
                      width: Int,
                      height: Int,
                      mappingName: Option[String],
                      image: Array[Byte]): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.dataSet_thumbnails (_dataSet, dataLayerName, width, height, image, created)
                   VALUES($datasetId, $layerName, $width, $height, $mappingName, $image, ${Instant.now})
                   ON CONFLICT (_dataSet, dataLayerName, width, height, mappingName)
                   DO UPDATE SET
                     image = $image,
                     created = ${Instant.now}
    """.asUpdate)
    } yield ()

  def removeAllForDataset(datasetId: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"DELETE FROM webknossos.dataSet_thumbnails WHERE _dataSet = $datasetId".asUpdate)
    } yield ()

  def removeAllExpired(expiryDuration: FiniteDuration): Fox[Unit] =
    for {
      _ <- run(q"DELETE FROM webknossos.dataSet_thumbnails WHERE created < ${Instant.now - expiryDuration}".asUpdate)
    } yield ()
}
