package com.scalableminds.webknossos.datastore.services.segmentstatistics

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.box.Box
import com.scalableminds.util.box.Box.tryo
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Fox, JsonHelper}
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.datastore.datareaders.DatasetArray
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3Array
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayer, DataSourceId, LayerAttachment}
import com.scalableminds.webknossos.datastore.services.{DSChunkCacheService, VoxelyticsZarrArtifactUtils}
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

case class SegmentStatisticsFileAttributes(formatVersion: Long, mag: Option[Vec3Int], mappingName: Option[String])

object SegmentStatisticsFileAttributes extends VoxelyticsZarrArtifactUtils {
  val minSupportedFormatVersion = 11

  private val attrKeyMag = "mag"
  private val attrKeyMappingName = "mapping_name"

  implicit object SegmentStatisticsFileAttributesZarr3GroupHeaderReads extends Reads[SegmentStatisticsFileAttributes] {
    override def reads(json: JsValue): JsResult[SegmentStatisticsFileAttributes] = {
      val segmentStatisticsFileAttrs = lookUpArtifactAttributes(json)
      for {
        formatVersion <- readArtifactSchemaVersion(json)
        mag <- (segmentStatisticsFileAttrs \ attrKeyMag).validateOpt[Vec3Int]
        mappingName <- (segmentStatisticsFileAttrs \ attrKeyMappingName).validateOpt[String]
      } yield SegmentStatisticsFileAttributes(formatVersion, mag, mappingName)
    }
  }
}

object SegmentStatisticsFileService {
  val keyCovarianceMatrix = "covariance_matrix"
  val keyMaxDistances = "max_distances"
  val keyCenterOfMass = "center_of_mass"
  val keySphericities = "sphericities"
  val keyIds = "ids"

  val possibleMetrics: Seq[String] =
    Seq("positions", keyMaxDistances, "volumes", keyCenterOfMass, keyCovarianceMatrix, "surfaces", keySphericities)
}

class SegmentStatisticsFileService @Inject() (
    dataVaultService: DataVaultService,
    chunkCacheService: DSChunkCacheService
) {

  // dataSourceId, layerName → SegmentStatisticsFileKey
  private val segmentStatisticsFileKeyCache: AlfuCache[(DataSourceId, String), SegmentStatisticsFileKey] = AlfuCache()

  private val attributesCache: AlfuCache[SegmentStatisticsFileKey, SegmentStatisticsFileAttributes] = AlfuCache()

  private val openArraysCache: AlfuCache[(SegmentStatisticsFileKey, String), DatasetArray] = AlfuCache()

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
      _ <- Fox.fromBool(
        segmentStatisticsFileAttributes.formatVersion >= SegmentStatisticsFileAttributes.minSupportedFormatVersion
      ) ?~> Msg.SegmentStatisticsFile.formatVersionTooOld(
        segmentStatisticsFileAttributes.formatVersion,
        SegmentStatisticsFileAttributes.minSupportedFormatVersion
      )
    } yield segmentStatisticsFileAttributes

  private def readSegmentStatisticsFileAttributes(
      segmentStatisticsFileKey: SegmentStatisticsFileKey
  )(using ec: ExecutionContext, tc: TokenContext): Fox[SegmentStatisticsFileAttributes] =
    attributesCache.getOrLoad(segmentStatisticsFileKey, key => readSegmentStatisticsFileAttributesImpl(key))

  private def openZarrArray(segmentStatisticsFileKey: SegmentStatisticsFileKey, zarrArrayName: String)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[DatasetArray] =
    openArraysCache.getOrLoad(
      (segmentStatisticsFileKey, zarrArrayName),
      _ => openZarrArrayImpl(segmentStatisticsFileKey, zarrArrayName)
    )

  private def openZarrArrayImpl(segmentStatisticsFileKey: SegmentStatisticsFileKey, zarrArrayName: String)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[DatasetArray] =
    for {
      groupVaultPath <- dataVaultService.vaultPathFor(segmentStatisticsFileKey.attachment)
      zarrArray <- Zarr3Array.open(
        groupVaultPath / zarrArrayName,
        DataSourceId("dummy", "unused"),
        "layer",
        None,
        None,
        None,
        chunkCacheService.sharedChunkContentsCache
      )
    } yield zarrArray

  private def availableMetrics(
      segmentStatisticsFileKey: SegmentStatisticsFileKey
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Seq[String]] =
    for {
      existsPerMetric <- Fox.serialCombined(SegmentStatisticsFileService.possibleMetrics) { metric =>
        openZarrArray(segmentStatisticsFileKey, metric).shiftBox.map(_.isDefined)
      }
      collected = SegmentStatisticsFileService.possibleMetrics.zip(existsPerMetric).collect { case (metric, true) =>
        metric
      }
    } yield collected

  private def checkMetricAvailable(segmentStatisticsFileKey: SegmentStatisticsFileKey, metric: String)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Unit] =
    for {
      metrics <- availableMetrics(segmentStatisticsFileKey)
      _ <- Fox.fromBool(metrics.contains(metric)) ?~> Msg.SegmentStatisticsFile.metricNotAvailable(metric)
    } yield ()

  private def resolveMagAndMappingName(segmentStatisticsFileKey: SegmentStatisticsFileKey, dataLayer: DataLayer)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[(Vec3Int, Option[String])] =
    for {
      attributes <- readSegmentStatisticsFileAttributes(segmentStatisticsFileKey)
      mag <- attributes.mag
        .orElse(dataLayer.finestMag)
        .toFox ?~> "Could not determine mag for segment statistics file, layer has no mags"
    } yield (mag, attributes.mappingName)

  def checkMagAndMappingNameMatch(
      segmentStatisticsFileKey: SegmentStatisticsFileKey,
      dataLayer: DataLayer,
      requestedMag: Vec3Int,
      requestedMappingName: Option[String]
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Unit] =
    for {
      (fileMag, fileMappingName) <- resolveMagAndMappingName(segmentStatisticsFileKey, dataLayer)
      _ <- Fox.fromBool(fileMag == requestedMag) ?~> Msg.SegmentStatisticsFile
        .magMismatch(requestedMag.toMagLiteral(true), fileMag.toMagLiteral(true))
      _ <- Fox.fromBool(
        fileMappingName.getOrElse("") == requestedMappingName.getOrElse("")
      ) ?~> Msg.SegmentStatisticsFile
        .mappingNameMismatch(requestedMappingName.getOrElse(""), fileMappingName.getOrElse(""))
    } yield ()

  private def readCovarianceMatrix(segmentStatisticsFileKey: SegmentStatisticsFileKey, segmentId: Long)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Array[Array[Float]]] =
    for {
      covarianceMatrixArray <- openZarrArray(segmentStatisticsFileKey, SegmentStatisticsFileService.keyCovarianceMatrix)
      multiArray <- covarianceMatrixArray.readAsMultiArray(offset = Array(segmentId, 0L, 0L), shape = Array(1, 3, 3))
      matrix <- tryo(
        Array.tabulate(3, 3)((i, j) => multiArray.getFloat(multiArray.getIndex.set(Array(0, i, j))))
      ).toFox
    } yield matrix

  def getCovarianceMatrices(segmentStatisticsFileKey: SegmentStatisticsFileKey, segmentIds: Seq[Long])(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Seq[Array[Array[Float]]]] =
    Fox.serialCombined(segmentIds)(readCovarianceMatrix(segmentStatisticsFileKey, _))

  private def readMaxDistance(segmentStatisticsFileKey: SegmentStatisticsFileKey, segmentId: Long)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Float] =
    for {
      maxDistancesArray <- openZarrArray(segmentStatisticsFileKey, SegmentStatisticsFileService.keyMaxDistances)
      multiArray <- maxDistancesArray.readAsMultiArray(offset = segmentId, shape = 1)
      maxDistance <- tryo(multiArray.getFloat(0)).toFox
    } yield maxDistance

  def getMaxDistances(segmentStatisticsFileKey: SegmentStatisticsFileKey, segmentIds: Seq[Long])(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Seq[Float]] =
    Fox.serialCombined(segmentIds)(readMaxDistance(segmentStatisticsFileKey, _))

  private def readCenterOfMass(segmentStatisticsFileKey: SegmentStatisticsFileKey, segmentId: Long)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Array[Float]] =
    for {
      centerOfMassArray <- openZarrArray(segmentStatisticsFileKey, SegmentStatisticsFileService.keyCenterOfMass)
      multiArray <- centerOfMassArray.readAsMultiArray(offset = Array(segmentId, 0L), shape = Array(1, 3))
      centerOfMass <- tryo(Array.tabulate(3)(i => multiArray.getFloat(multiArray.getIndex.set(Array(0, i))))).toFox
    } yield centerOfMass

  def getCenterOfMasses(segmentStatisticsFileKey: SegmentStatisticsFileKey, segmentIds: Seq[Long])(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Seq[Array[Float]]] =
    Fox.serialCombined(segmentIds)(readCenterOfMass(segmentStatisticsFileKey, _))

  private def readSphericity(segmentStatisticsFileKey: SegmentStatisticsFileKey, segmentId: Long)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Float] =
    for {
      sphericitiesArray <- openZarrArray(segmentStatisticsFileKey, SegmentStatisticsFileService.keySphericities)
      multiArray <- sphericitiesArray.readAsMultiArray(offset = segmentId, shape = 1)
      sphericity <- tryo(multiArray.getFloat(0)).toFox
    } yield sphericity

  def getSphericities(segmentStatisticsFileKey: SegmentStatisticsFileKey, segmentIds: Seq[Long])(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Seq[Float]] =
    for {
      _ <- checkMetricAvailable(segmentStatisticsFileKey, SegmentStatisticsFileService.keySphericities)
      sphericities <- Fox.serialCombined(segmentIds)(readSphericity(segmentStatisticsFileKey, _))
    } yield sphericities

  private def checkIdsAreDense(
      segmentStatisticsFileKey: SegmentStatisticsFileKey
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Unit] =
    for {
      idsArray <- openZarrArray(segmentStatisticsFileKey, SegmentStatisticsFileService.keyIds)
      length <- idsArray.datasetShape
        .flatMap(_.headOption)
        .toFox ?~> "Could not determine length of ids array in segment statistics file"
      firstMultiArray <- idsArray.readAsMultiArray(offset = 0L, shape = 1)
      lastMultiArray <- idsArray.readAsMultiArray(offset = length - 1, shape = 1)
      // the underlying dtype of ids may vary, but getLong will auto-convert to long.
      first <- tryo(firstMultiArray.getLong(0)).toFox
      last <- tryo(lastMultiArray.getLong(0)).toFox
      _ <- Fox.fromBool(first == 0 && last == length - 1) ?~> Msg.SegmentStatisticsFile.idsNotDense(first, last, length)
    } yield ()

  def getInfos(dataSourceId: DataSourceId, dataLayer: DataLayer)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[SegmentStatisticsFileInfos] = for {
    key <- lookUpSegmentStatisticsFileKey(dataSourceId, dataLayer)
    (mag, mappingName) <- resolveMagAndMappingName(key, dataLayer)
    _ <- checkIdsAreDense(key)
    metrics <- availableMetrics(key)
  } yield SegmentStatisticsFileInfos(mag, metrics, mappingName)

  def clearCache(dataSourceId: DataSourceId, layerNameOpt: Option[String]): Int = {
    attributesCache.clear { key =>
      key.dataSourceId == dataSourceId && layerNameOpt.forall(_ == key.layerName)
    }

    openArraysCache.clear { case (key, _) =>
      key.dataSourceId == dataSourceId && layerNameOpt.forall(_ == key.layerName)
    }

    segmentStatisticsFileKeyCache.clear { case (keyDataSourceId, keyLayerName) =>
      dataSourceId == keyDataSourceId && layerNameOpt.forall(_ == keyLayerName)
    }
  }
}
