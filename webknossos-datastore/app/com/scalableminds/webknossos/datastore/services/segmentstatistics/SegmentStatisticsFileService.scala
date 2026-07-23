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
  private val keyPositions = "positions"
  private val keyCovarianceMatrix = "covariance_matrix"
  private val keyMaxDistances = "max_distances"
  private val keyCenterOfMass = "center_of_mass"
  private val keySphericities = "sphericities"
  private val keyVolumes = "volumes"
  private val keySurfaceAreas = "surfaces"
  private val keyIds = "ids"

  private val possibleMetrics: Seq[String] =
    Seq(
      keyPositions,
      keyMaxDistances,
      keyVolumes,
      keyCenterOfMass,
      keyCovarianceMatrix,
      keySurfaceAreas,
      keySphericities
    )
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
        .readBytes() ?~> Msg.SegmentStatisticsFile.readGroupHeaderFailed
      segmentStatisticsFileAttributes <- JsonHelper
        .parseAs[SegmentStatisticsFileAttributes](groupHeaderBytes)
        .toFox ?~> Msg.SegmentStatisticsFile.parseAttributesFailed
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

  // Reads are batched (parallel) for remote storage, where per-read latency dominates, and serial for local
  // storage, where parallel reads would only add contention without saving wall-clock time.
  private def combinedOverSegmentIds[B](segmentStatisticsFileKey: SegmentStatisticsFileKey, segmentIds: Seq[Long])(
      f: Long => Fox[B]
  )(implicit ec: ExecutionContext): Fox[Seq[B]] =
    if (segmentStatisticsFileKey.attachment.path.isRemote)
      Fox.batchCombined(segmentIds, parallelity = 32)(f)
    else
      Fox.serialCombined(segmentIds)(f)

  private def resolveMappingName(
      segmentStatisticsFileKey: SegmentStatisticsFileKey
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Option[String]] =
    for {
      attributes <- readSegmentStatisticsFileAttributes(segmentStatisticsFileKey)
      mappingName = attributes.mappingName.filter(_.nonEmpty) // Emptystring to None
    } yield mappingName

  private def resolveMagAndMappingName(segmentStatisticsFileKey: SegmentStatisticsFileKey, dataLayer: DataLayer)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[(Vec3Int, Option[String])] =
    for {
      attributes <- readSegmentStatisticsFileAttributes(segmentStatisticsFileKey)
      mag <- attributes.mag
        .orElse(dataLayer.finestMag)
        .toFox ?~> "Could not determine mag for segment statistics file, layer has no mags"
      mappingName <- resolveMappingName(segmentStatisticsFileKey)
    } yield (mag, mappingName)

  // Whether serving requestedMappingName for this file would require recombining oversegmentation values,
  // i.e. the file’s own mapping (if any) differs from the one being requested.
  def needsRemapping(segmentStatisticsFileKey: SegmentStatisticsFileKey, requestedMappingName: Option[String])(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Boolean] =
    for {
      fileMappingName <- resolveMappingName(segmentStatisticsFileKey)
    } yield fileMappingName != requestedMappingName.filter(_.nonEmpty)

  def checkMagAndMappingNameMatch(
      segmentStatisticsFileKey: SegmentStatisticsFileKey,
      dataLayer: DataLayer,
      requestedMag: Vec3Int,
      requestedMappingName: Option[String],
      // If true, mappings may be requested if the file was computed for the oversegmentation.
      allowRemapping: Boolean
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Unit] =
    for {
      (fileMag, fileMappingName) <- resolveMagAndMappingName(segmentStatisticsFileKey, dataLayer)
      _ <- Fox.fromBool(fileMag <= requestedMag) ?~> Msg.SegmentStatisticsFile
        .magTooFine(requestedMag.toMagLiteral(true), fileMag.toMagLiteral(true))
      remappingNeeded <- needsRemapping(segmentStatisticsFileKey, requestedMappingName)
      _ <-
        if (!remappingNeeded) Fox.successful(())
        else if (allowRemapping) {
          Fox.fromBool(fileMappingName.isEmpty) ?~> Msg.SegmentStatisticsFile.remappingRequiresUnmappedFile(
            fileMappingName.getOrElse("(none)")
          )
        } else {
          Fox.failure(
            Msg.SegmentStatisticsFile.mappingNameMismatch(
              requestedMappingName.filter(_.nonEmpty).getOrElse("(none)"),
              fileMappingName.getOrElse("(none)")
            )
          )
        }
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
    combinedOverSegmentIds(segmentStatisticsFileKey, segmentIds)(readCovarianceMatrix(segmentStatisticsFileKey, _))

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
    combinedOverSegmentIds(segmentStatisticsFileKey, segmentIds)(readMaxDistance(segmentStatisticsFileKey, _))

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
    combinedOverSegmentIds(segmentStatisticsFileKey, segmentIds)(readCenterOfMass(segmentStatisticsFileKey, _))

  private def readVolume(segmentStatisticsFileKey: SegmentStatisticsFileKey, segmentId: Long)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Long] =
    for {
      volumesArray <- openZarrArray(segmentStatisticsFileKey, SegmentStatisticsFileService.keyVolumes)
      multiArray <- volumesArray.readAsMultiArray(offset = segmentId, shape = 1)
      // the underlying dtype of volumes may vary, but getLong will auto-convert to long.
      volume <- tryo(multiArray.getLong(0)).toFox
    } yield volume

  def getVolumes(segmentStatisticsFileKey: SegmentStatisticsFileKey, segmentIds: Seq[Long])(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Seq[Long]] =
    for {
      _ <- checkMetricAvailable(segmentStatisticsFileKey, SegmentStatisticsFileService.keyVolumes)
      volumes <- combinedOverSegmentIds(segmentStatisticsFileKey, segmentIds)(readVolume(segmentStatisticsFileKey, _))
    } yield volumes

  // Volumes are stored as voxel counts in the segment statistics file’s own mag. A coarser requested mag has larger
  // voxels, so the stored count must be scaled down (by the ratio of voxel sizes) to match the requested mag.
  private def rescaleVolumeToMag(volume: Long, fileMag: Vec3Int, requestedMag: Vec3Int): Long =
    if (fileMag == requestedMag) volume
    else volume * fileMag.product / requestedMag.product

  def getVolumesInRequestedMag(
      segmentStatisticsFileKey: SegmentStatisticsFileKey,
      dataLayer: DataLayer,
      segmentIds: Seq[Long],
      requestedMag: Vec3Int
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Seq[Long]] =
    for {
      volumes <- getVolumes(segmentStatisticsFileKey, segmentIds)
      (fileMag, _) <- resolveMagAndMappingName(segmentStatisticsFileKey, dataLayer)
    } yield volumes.map(rescaleVolumeToMag(_, fileMag, requestedMag))

  /** Combines the volumes of several (oversegmentation) segments into the volume of their union (a plain sum, exact as
    * long as the given segments are disjoint), then rescales the result from the file’s own mag to requestedMag.
    */
  def getCombinedVolumeInRequestedMag(
      segmentStatisticsFileKey: SegmentStatisticsFileKey,
      dataLayer: DataLayer,
      segmentIds: Seq[Long],
      requestedMag: Vec3Int
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Long] =
    for {
      volumes <- getVolumes(segmentStatisticsFileKey, segmentIds)
      (fileMag, _) <- resolveMagAndMappingName(segmentStatisticsFileKey, dataLayer)
    } yield rescaleVolumeToMag(volumes.sum, fileMag, requestedMag)

  // Center of mass and covariance matrix are always stored in mag1 voxel units, regardless of the file’s own mag, so
  // volumes must be rescaled to mag1 before being used as weights to combine those two metrics across oversegments.
  private def volumesInMag1(
      segmentStatisticsFileKey: SegmentStatisticsFileKey,
      dataLayer: DataLayer,
      segmentIds: Seq[Long]
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Seq[Long]] =
    for {
      volumes <- getVolumes(segmentStatisticsFileKey, segmentIds)
      (fileMag, _) <- resolveMagAndMappingName(segmentStatisticsFileKey, dataLayer)
    } yield volumes.map(rescaleVolumeToMag(_, fileMag, Vec3Int.ones))

  // The volume-weighted average of centerOfMasses, per dimension, as Double for precision. totalVolume must be > 0.
  private def weightedCenterOfMass(
      centerOfMasses: Seq[Array[Float]],
      volumes: Seq[Long],
      totalVolume: Long
  ): Array[Double] =
    Array.tabulate(3) { dim =>
      val weightedSum = centerOfMasses
        .lazyZip(volumes)
        .map { case (centerOfMass, volume) =>
          centerOfMass(dim).toDouble * volume
        }
        .sum
      weightedSum / totalVolume
    }

  /** Combines the centers of mass of several (oversegmentation) segments into the center of mass of their union,
    * weighting each one by its volume. This is exact (not an approximation), as long as the given segments are disjoint
    * (do not overlap). If a single segment id is given, this just returns its own center of mass.
    */
  def getCombinedCenterOfMass(
      segmentStatisticsFileKey: SegmentStatisticsFileKey,
      dataLayer: DataLayer,
      segmentIds: Seq[Long]
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Array[Float]] =
    for {
      centerOfMasses <- getCenterOfMasses(segmentStatisticsFileKey, segmentIds)
      volumes <- volumesInMag1(segmentStatisticsFileKey, dataLayer, segmentIds)
      totalVolume = volumes.sum
      _ <- Fox.fromBool(totalVolume > 0) ?~> "Cannot compute combined center of mass, total volume of segments is zero"
      combined = weightedCenterOfMass(centerOfMasses, volumes, totalVolume).map(_.toFloat)
    } yield combined

  /** Combines the covariance matrices of several (oversegmentation) segments into the covariance matrix of their union,
    * via the parallel axis theorem: each segment’s covariance is shifted from its own center of mass to the combined
    * center of mass (adding the outer product of that offset with itself), then volume-weighted-averaged. This is exact
    * (not an approximation), as long as the given segments are disjoint (do not overlap). If a single segment id is
    * given, this just returns its own covariance matrix.
    */
  def getCombinedCovarianceMatrix(
      segmentStatisticsFileKey: SegmentStatisticsFileKey,
      dataLayer: DataLayer,
      segmentIds: Seq[Long]
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Array[Array[Float]]] =
    for {
      covarianceMatrices <- getCovarianceMatrices(segmentStatisticsFileKey, segmentIds)
      centerOfMasses <- getCenterOfMasses(segmentStatisticsFileKey, segmentIds)
      volumes <- volumesInMag1(segmentStatisticsFileKey, dataLayer, segmentIds)
      totalVolume = volumes.sum
      _ <- Fox.fromBool(
        totalVolume > 0
      ) ?~> "Cannot compute combined covariance matrix, total volume of segments is zero"
      combinedCenterOfMass = weightedCenterOfMass(centerOfMasses, volumes, totalVolume)
      combined = Array.tabulate(3, 3) { (i, j) =>
        val weightedSum = covarianceMatrices.indices.map { idx =>
          val volume = volumes(idx)
          val covariance = covarianceMatrices(idx)(i)(j).toDouble
          val offsetI = centerOfMasses(idx)(i).toDouble - combinedCenterOfMass(i)
          val offsetJ = centerOfMasses(idx)(j).toDouble - combinedCenterOfMass(j)
          volume * (covariance + offsetI * offsetJ)
        }.sum
        (weightedSum / totalVolume).toFloat
      }
    } yield combined

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
      sphericities <- combinedOverSegmentIds(segmentStatisticsFileKey, segmentIds)(
        readSphericity(segmentStatisticsFileKey, _)
      )
    } yield sphericities

  private def readSurfaceArea(segmentStatisticsFileKey: SegmentStatisticsFileKey, segmentId: Long)(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Float] =
    for {
      surfaceAreasArray <- openZarrArray(segmentStatisticsFileKey, SegmentStatisticsFileService.keySurfaceAreas)
      multiArray <- surfaceAreasArray.readAsMultiArray(offset = segmentId, shape = 1)
      surfaceArea <- tryo(multiArray.getFloat(0)).toFox
    } yield surfaceArea

  def getSurfaceAreas(segmentStatisticsFileKey: SegmentStatisticsFileKey, segmentIds: Seq[Long])(using
      ec: ExecutionContext,
      tc: TokenContext
  ): Fox[Seq[Float]] =
    for {
      _ <- checkMetricAvailable(segmentStatisticsFileKey, SegmentStatisticsFileService.keySurfaceAreas)
      surfaceAreas <- combinedOverSegmentIds(segmentStatisticsFileKey, segmentIds)(
        readSurfaceArea(segmentStatisticsFileKey, _)
      )
    } yield surfaceAreas

  private def checkIdsAreDense(
      segmentStatisticsFileKey: SegmentStatisticsFileKey
  )(using ec: ExecutionContext, tc: TokenContext): Fox[Unit] =
    for {
      idsArray <- openZarrArray(segmentStatisticsFileKey, SegmentStatisticsFileService.keyIds)
      length <- idsArray.datasetShape
        .flatMap(_.headOption)
        .toFox ?~> "Could not determine length of ids array in segment statistics file"
      _ <- Fox.fromBool(length > 0) ?~> Msg.SegmentStatisticsFile.idsEmpty
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
