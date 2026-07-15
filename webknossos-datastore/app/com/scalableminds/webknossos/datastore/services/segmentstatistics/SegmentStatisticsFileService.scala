package com.scalableminds.webknossos.datastore.services.segmentstatistics

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.box.Box
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSourceId, LayerAttachment}
import com.scalableminds.webknossos.datastore.services.VoxelyticsZarrArtifactUtils
import com.scalableminds.webknossos.datastore.storage.{AttachmentKey, DataVaultService}
import play.api.libs.json.{Json, JsResult, JsValue, OFormat, Reads}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class SegmentStatisticsFileKey(dataSourceId: DataSourceId, layerName: String, attachment: LayerAttachment)
    extends AttachmentKey

case class SegmentStatisticsFileInfos(mag: Vec3Int, availableMetrics: Seq[String], mappingName: Option[String])

object SegmentStatisticsFileInfos {
  implicit val jsonFormat: OFormat[SegmentStatisticsFileInfos] = Json.format[SegmentStatisticsFileInfos]
}

case class SegmentStatisticsFileAttributes(mag: Option[Vec3Int], mappingName: Option[String])

object SegmentStatisticsFileAttributes extends VoxelyticsZarrArtifactUtils {
  private val attrKeyMag = "mag"
  private val attrKeyMappingName = "mapping_name"

  implicit object SegmentStatisticsFileAttributesZarr3GroupHeaderReads extends Reads[SegmentStatisticsFileAttributes] {
    override def reads(json: JsValue): JsResult[SegmentStatisticsFileAttributes] = {
      val segmentStatisticsFileAttrs = lookUpArtifactAttributes(json)
      for {
        mag <- (segmentStatisticsFileAttrs \ attrKeyMag).validateOpt[Vec3Int]
        mappingName <- (segmentStatisticsFileAttrs \ attrKeyMappingName).validateOpt[String]
      } yield SegmentStatisticsFileAttributes(mag, mappingName)
    }
  }
}

class SegmentStatisticsFileService @Inject() (dataVaultService: DataVaultService) {

  private val segmentStatisticsFileKeyCache: AlfuCache[(DataSourceId, String), SegmentStatisticsFileKey] =
    AlfuCache() // dataSourceId, layerName → SegmentStatisticsFileKey

  private val attributesCache: AlfuCache[SegmentStatisticsFileKey, SegmentStatisticsFileAttributes] =
    AlfuCache()

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

  private def readSegmentStatisticsFileAttributesImpl(
      segmentStatisticsFileKey: SegmentStatisticsFileKey
  )(using ec: ExecutionContext, tc: TokenContext): Fox[SegmentStatisticsFileAttributes] =
    for {
      groupVaultPath <- dataVaultService.vaultPathFor(segmentStatisticsFileKey.attachment)
      groupHeaderBytes <- (groupVaultPath / SegmentStatisticsFileAttributes.FILENAME_ZARR_JSON)
        .readBytes() ?~> "Could not read segment statistics file zarr group file"
      segmentStatisticsFileAttributes <- JsonHelper
        .parseAs[SegmentStatisticsFileAttributes](groupHeaderBytes)
        .toFox ?~> "Could not parse segment statistics file attributes from zarr group file."
    } yield segmentStatisticsFileAttributes

  private def readSegmentStatisticsFileAttributes(
      segmentStatisticsFileKey: SegmentStatisticsFileKey
  )(using ec: ExecutionContext, tc: TokenContext): Fox[SegmentStatisticsFileAttributes] =
    attributesCache.getOrLoad(segmentStatisticsFileKey, key => readSegmentStatisticsFileAttributesImpl(key))

  def getInfos(dataSourceId: DataSourceId, dataLayer: DataLayer)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[SegmentStatisticsFileInfos] = for {
    key <- lookUpSegmentStatisticsFileKey(dataSourceId, dataLayer)
    attributes <- readSegmentStatisticsFileAttributes(key)
    mag <- attributes.mag
      .orElse(dataLayer.finestMag)
      .toFox ?~> "Could not determine mag for segment statistics file, layer has no mags"
  } yield SegmentStatisticsFileInfos(mag, Seq.empty, attributes.mappingName)

  def clearCache(dataSourceId: DataSourceId, layerNameOpt: Option[String]): Int = {
    attributesCache.clear { key =>
      key.dataSourceId == dataSourceId && layerNameOpt.forall(_ == key.layerName)
    }

    segmentStatisticsFileKeyCache.clear { case (keyDataSourceId, keyLayerName) =>
      dataSourceId == keyDataSourceId && layerNameOpt.forall(_ == keyLayerName)
    }
  }
}
