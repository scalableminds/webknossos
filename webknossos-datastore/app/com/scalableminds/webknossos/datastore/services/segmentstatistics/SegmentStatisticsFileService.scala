package com.scalableminds.webknossos.datastore.services.segmentstatistics

import com.scalableminds.util.Msg
import com.scalableminds.util.box.Box
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSourceId, LayerAttachment}
import com.scalableminds.webknossos.datastore.storage.AttachmentKey
import play.api.libs.json.{Json, OFormat}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class SegmentStatisticsFileKey(dataSourceId: DataSourceId, layerName: String, attachment: LayerAttachment)
    extends AttachmentKey

case class SegmentStatisticsFileInfos(mag: Vec3Int, availableMetrics: Seq[String], mappingName: Option[String])

object SegmentStatisticsFileInfos {
  implicit val jsonFormat: OFormat[SegmentStatisticsFileInfos] = Json.format[SegmentStatisticsFileInfos]
}

class SegmentStatisticsFileService @Inject() {

  private val segmentStatisticsFileKeyCache: AlfuCache[(DataSourceId, String), SegmentStatisticsFileKey] =
    AlfuCache() // dataSourceId, layerName → SegmentStatisticsFileKey

  def lookUpSegmentStatisticsFileKey(dataSourceId: DataSourceId, dataLayer: DataLayer)(implicit
      ec: ExecutionContext
  ): Fox[SegmentStatisticsFileKey] =
    segmentStatisticsFileKeyCache.getOrLoad(
      (dataSourceId, dataLayer.name),
      _ => lookUpSegmentStatisticsFileKeyImpl(dataSourceId, dataLayer).toFox
    )

  private def lookUpSegmentStatisticsFileKeyImpl(
      dataSourceId: DataSourceId,
      dataLayer: DataLayer
  ): Box[SegmentStatisticsFileKey] =
    for {
      attachment <- Box.fromOption(dataLayer.attachments.flatMap(_.segmentStatistics))
      _ <- Box.fromBool(attachment.path.isAbsolute) ?~> Msg.SegmentStatisticsFile.pathNotAbsolute
    } yield SegmentStatisticsFileKey(
      dataSourceId,
      dataLayer.name,
      attachment
    )

  def getInfos(dataSourceId: DataSourceId, dataLayer: DataLayer)(implicit
      ec: ExecutionContext
  ): Fox[SegmentStatisticsFileInfos] = for {
    key <- lookUpSegmentStatisticsFileKey(dataSourceId, dataLayer)
    // TODO read from file metadata
  } yield SegmentStatisticsFileInfos(Vec3Int.ones, Seq.empty, None)

  def clearCache(dataSourceId: DataSourceId, layerNameOpt: Option[String]): Int =
    segmentStatisticsFileKeyCache.clear { case (keyDataSourceId, keyLayerName) =>
      dataSourceId == keyDataSourceId && layerNameOpt.forall(_ == keyLayerName)
    }
}
