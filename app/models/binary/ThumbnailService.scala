package models.binary
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.tools.Fox.option2Fox
import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayerLike, GenericDataSource}
import com.scalableminds.webknossos.datastore.storage.TemporaryStore
import play.api.http.Status.NOT_FOUND
import play.api.i18n.{Messages, MessagesProvider}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

class ThumbnailService @Inject()(dataSetService: DataSetService,
                                 dataSetDAO: DataSetDAO,
                                 thumbnailCache: TemporaryStore[String, Array[Byte]]) {

  private val DefaultThumbnailWidth = 400
  private val DefaultThumbnailHeight = 400
  private val MaxThumbnailWidth = 4000
  private val MaxThumbnailHeight = 4000

  private val ThumbnailCacheDuration = 1 day

  private def thumbnailCacheKey(organizationName: String,
                                dataSetName: String,
                                dataLayerName: String,
                                width: Int,
                                height: Int,
                                mappingName: Option[String]) =
    s"thumbnail-$organizationName*$dataSetName*$dataLayerName-$width-$height-$mappingName"

  def removeFromCache(organizationName: String, datasetName: String): Unit =
    thumbnailCache.removeAllConditional(_.startsWith(s"thumbnail-$organizationName*$datasetName"))

  def getThumbnailWithCache(
      organizationName: String,
      datasetName: String,
      dataLayerName: String,
      w: Option[Int],
      h: Option[Int],
      mappingName: Option[String])(implicit ec: ExecutionContext, mp: MessagesProvider): Fox[Array[Byte]] = {
    val width = com.scalableminds.util.tools.Math.clamp(w.getOrElse(DefaultThumbnailWidth), 1, MaxThumbnailWidth)
    val height = com.scalableminds.util.tools.Math.clamp(h.getOrElse(DefaultThumbnailHeight), 1, MaxThumbnailHeight)
    thumbnailCache.find(thumbnailCacheKey(organizationName, datasetName, dataLayerName, width, height, mappingName)) match {
      case Some(image) =>
        Fox.successful(image)
      case _ =>
        getThumbnail(organizationName, datasetName, dataLayerName, width, height, mappingName)(ec,
                                                                                               GlobalAccessContext,
                                                                                               mp)
    }
  }

  private def getThumbnail(organizationName: String,
                           datasetName: String,
                           dataLayerName: String,
                           width: Int,
                           height: Int,
                           mappingName: Option[String])(implicit ec: ExecutionContext,
                                                        ctx: DBAccessContext,
                                                        mp: MessagesProvider): Fox[Array[Byte]] =
    for {
      dataset <- dataSetDAO.findOneByNameAndOrganizationName(datasetName, organizationName)
      dataSource <- dataSetService.dataSourceFor(dataset) ?~> "dataSource.notFound" ~> NOT_FOUND
      usableDataSource <- dataSource.toUsable.toFox ?~> "dataSet.notImported"
      layer <- usableDataSource.dataLayers.find(_.name == dataLayerName) ?~> Messages("dataLayer.notFound",
                                                                                      dataLayerName) ~> NOT_FOUND
      (mag1BoundingBox, mag) = selectBoundingBox(dataset, usableDataSource, layer, width, height)
      client <- dataSetService.clientFor(dataset)
      image <- client.getDataLayerThumbnail(organizationName, dataset, dataLayerName, mag1BoundingBox, mag, mappingName)
      // We don't want all images to expire at the same time. Therefore, we add some random variation
      _ = thumbnailCache.insert(
        thumbnailCacheKey(organizationName, datasetName, dataLayerName, width, height, mappingName),
        image,
        Some((ThumbnailCacheDuration.toSeconds + math.random * 2.hours.toSeconds) seconds)
      )
    } yield image

  private def selectBoundingBox(dataset: DataSet,
                                usableDataSource: GenericDataSource[DataLayerLike],
                                layer: DataLayerLike,
                                width: Int,
                                height: Int): (BoundingBox, Vec3Int) = {
    val configuredCenterOpt = dataset.adminViewConfiguration.flatMap(c =>
      c.get("position").flatMap(jsValue => JsonHelper.jsResultToOpt(jsValue.validate[Vec3Int])))
    val centerOpt =
      configuredCenterOpt.orElse(BoundingBox.intersection(usableDataSource.dataLayers.map(_.boundingBox)).map(_.center))
    val center = centerOpt.getOrElse(layer.boundingBox.center)
    val zoom = dataset.adminViewConfiguration
      .flatMap(c => c.get("zoom").flatMap(jsValue => JsonHelper.jsResultToOpt(jsValue.validate[Double])))
      .getOrElse(1.0)
    val mag = magForZoom(layer, zoom)
    val x = Math.max(0, center.x - width * mag.x / 2)
    val y = Math.max(0, center.y - height * mag.y / 2)
    val z = center.z
    (BoundingBox(Vec3Int(x, y, z), width, height, 1), mag)
  }

  private def magForZoom(dataLayer: DataLayerLike, zoom: Double): Vec3Int =
    dataLayer.resolutions.minBy(r => Math.abs(r.maxDim - zoom))

}
