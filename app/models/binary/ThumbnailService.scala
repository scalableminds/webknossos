package models.binary
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.geometry.{BoundingBox, Vec3Int}
import com.scalableminds.util.tools.Fox.{bool2Fox, option2Fox}
import com.scalableminds.util.tools.{Fox, JsonHelper, Math}
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
                                height: Int) =
    s"thumbnail-$organizationName*$dataSetName*$dataLayerName-$width-$height"

  def removeFromCache(organizationName: String, datasetName: String): Unit =
    thumbnailCache.removeAllConditional(_.startsWith(s"thumbnail-$organizationName*$datasetName"))

  def getThumbnailWithCache(organizationName: String,
                            datasetName: String,
                            dataLayerName: String,
                            w: Option[Int],
                            h: Option[Int])(implicit ec: ExecutionContext, mp: MessagesProvider): Fox[Array[Byte]] = {
    val width = Math.clamp(w.getOrElse(DefaultThumbnailWidth), 1, MaxThumbnailWidth)
    val height = Math.clamp(h.getOrElse(DefaultThumbnailHeight), 1, MaxThumbnailHeight)
    thumbnailCache.find(thumbnailCacheKey(organizationName, datasetName, dataLayerName, width, height)) match {
      case Some(image) =>
        Fox.successful(image)
      case _ => getThumbnail(organizationName, datasetName, dataLayerName, width, height)(ec, GlobalAccessContext, mp)
    }
  }

  private def getThumbnail(
      organizationName: String,
      datasetName: String,
      dataLayerName: String,
      width: Int,
      height: Int)(implicit ec: ExecutionContext, ctx: DBAccessContext, mp: MessagesProvider): Fox[Array[Byte]] =
    for {
      dataset <- dataSetDAO.findOneByNameAndOrganizationName(datasetName, organizationName)
      dataSource <- dataSetService.dataSourceFor(dataset) ?~> "dataSource.notFound" ~> NOT_FOUND
      usableDataSource <- dataSource.toUsable.toFox ?~> "dataSet.notImported"
      _ <- bool2Fox(usableDataSource.dataLayers.exists(_.name == dataLayerName)) ?~> Messages(
        "dataLayer.notFound",
        dataLayerName) ~> NOT_FOUND
      (centerOpt, zoomOpt) = getConfiguredParameters(dataset, usableDataSource)
      client <- dataSetService.clientFor(dataset)
      image <- client.getDataLayerThumbnail(organizationName, dataset, dataLayerName, width, height, zoomOpt, centerOpt)
      // We don't want all images to expire at the same time. Therefore, we add some random variation
      _ = thumbnailCache.insert(
        thumbnailCacheKey(organizationName, datasetName, dataLayerName, width, height),
        image,
        Some((ThumbnailCacheDuration.toSeconds + math.random * 2.hours.toSeconds) seconds)
      )
    } yield image

  private def getConfiguredParameters(
      dataset: DataSet,
      usableDataSource: GenericDataSource[DataLayerLike]): (Option[Vec3Int], Option[Double]) = {
    val configuredCenterOpt = dataset.adminViewConfiguration.flatMap(c =>
      c.get("position").flatMap(jsValue => JsonHelper.jsResultToOpt(jsValue.validate[Vec3Int])))
    val centerOpt =
      configuredCenterOpt.orElse(BoundingBox.intersection(usableDataSource.dataLayers.map(_.boundingBox)).map(_.center))
    val configuredZoomOpt = dataset.adminViewConfiguration.flatMap(c =>
      c.get("zoom").flatMap(jsValue => JsonHelper.jsResultToOpt(jsValue.validate[Double])))
    (centerOpt, configuredZoomOpt)
  }

}
