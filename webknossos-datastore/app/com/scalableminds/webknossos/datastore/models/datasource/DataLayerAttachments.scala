package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{Box, Full}
import com.scalableminds.webknossos.datastore.helpers.UPath
import org.apache.commons.io.FilenameUtils
import play.api.libs.json.{Format, Json}

import java.nio.file.{Files, Path}

case class DataLayerAttachments(
    meshes: Seq[LayerAttachment] = Seq.empty,
    agglomerates: Seq[LayerAttachment] = Seq.empty,
    segmentIndex: Option[LayerAttachment] = None,
    connectomes: Seq[LayerAttachment] = Seq.empty,
    cumsum: Option[LayerAttachment] = None
) {
  def allAttachments: Seq[LayerAttachment] = meshes ++ agglomerates ++ segmentIndex ++ connectomes ++ cumsum
  def isEmpty: Boolean = allAttachments.isEmpty

  def merge(other: DataLayerAttachments): DataLayerAttachments =
    DataLayerAttachments(
      meshes = if (this.meshes.isEmpty) other.meshes else this.meshes,
      agglomerates = if (this.agglomerates.isEmpty) other.agglomerates else this.agglomerates,
      segmentIndex = this.segmentIndex.orElse(other.segmentIndex),
      connectomes = if (this.connectomes.isEmpty) other.connectomes else this.connectomes,
      cumsum = this.cumsum.orElse(other.cumsum)
    )

  def resolvedIn(dataSourcePath: UPath): DataLayerAttachments =
    DataLayerAttachments(
      meshes = meshes.map(_.resolvedIn(dataSourcePath)),
      agglomerates = agglomerates.map(_.resolvedIn(dataSourcePath)),
      segmentIndex = segmentIndex.map(_.resolvedIn(dataSourcePath)),
      connectomes = connectomes.map(_.resolvedIn(dataSourcePath)),
      cumsum = cumsum.map(_.resolvedIn(dataSourcePath))
    )

  def relativizedIn(dataSourcePath: UPath): DataLayerAttachments =
    DataLayerAttachments(
      meshes = meshes.map(_.relativizedIn(dataSourcePath)),
      agglomerates = agglomerates.map(_.relativizedIn(dataSourcePath)),
      segmentIndex = segmentIndex.map(_.relativizedIn(dataSourcePath)),
      connectomes = connectomes.map(_.relativizedIn(dataSourcePath)),
      cumsum = cumsum.map(_.relativizedIn(dataSourcePath))
    )
}

object DataLayerAttachments {
  implicit val jsonFormat: Format[DataLayerAttachments] =
    Json.using[Json.WithDefaultValues].format[DataLayerAttachments]
}

object LayerAttachmentDataformat extends ExtendedEnumeration {
  type LayerAttachmentDataformat = Value
  val hdf5, json, zarr3, neuroglancerPrecomputed = Value

  def suffixFor(attachmentType: LayerAttachmentDataformat): String = attachmentType match {
    case LayerAttachmentDataformat.hdf5                    => ".hdf5"
    case LayerAttachmentDataformat.json                    => ".json"
    case LayerAttachmentDataformat.zarr3                   => ""
    case LayerAttachmentDataformat.neuroglancerPrecomputed => ""
  }
}

object LayerAttachmentType extends ExtendedEnumeration {
  type LayerAttachmentType = Value
  val mesh, agglomerate, segmentIndex, connectome, cumsum = Value

  def defaultDirectoryNameFor(attachmentType: LayerAttachmentType): String = attachmentType match {
    case LayerAttachmentType.mesh         => MeshFileInfo.directoryName
    case LayerAttachmentType.agglomerate  => AgglomerateFileInfo.directoryName
    case LayerAttachmentType.segmentIndex => SegmentIndexFileInfo.directoryName
    case LayerAttachmentType.connectome   => ConnectomeFileInfo.directoryName
    case LayerAttachmentType.cumsum       => CumsumFileInfo.directoryName
  }

  def isSingletonAttachment(attachmentType: LayerAttachmentType): Boolean = attachmentType match {
    case LayerAttachmentType.segmentIndex | LayerAttachmentType.cumsum => true
    case _                                                             => false
  }

}

case class LayerAttachment(name: String,
                           path: UPath,
                           dataFormat: LayerAttachmentDataformat.LayerAttachmentDataformat,
                           credentialId: Option[String] = None) {
  // Warning: throws! Use inside of tryo
  def localPathUnsafe: Path = path.toLocalPathUnsafe

  def resolvedPath(dataBaseDir: Path, dataSourceId: DataSourceId): UPath = {
    val datasetPath = UPath.fromLocalPath(dataBaseDir) / dataSourceId.organizationId / dataSourceId.directoryName
    path.resolvedIn(datasetPath)
  }

  def resolvedIn(dataSourcePath: UPath): LayerAttachment =
    this.copy(path = this.path.resolvedIn(dataSourcePath))

  def relativizedIn(dataSourcePath: UPath): LayerAttachment =
    this.copy(path = this.path.relativizedIn(dataSourcePath))
}

object LayerAttachment {
  implicit val jsonFormat: Format[LayerAttachment] = Json.format[LayerAttachment]

  def scanForFiles(layerDirectory: Path,
                   directoryName: String,
                   dataFormat: LayerAttachmentDataformat.LayerAttachmentDataformat): Seq[LayerAttachment] = {
    val dir = layerDirectory.resolve(directoryName)
    val scanExtension = dataFormat.toString
    if (Files.exists(dir)) {
      val paths: Box[List[Path]] =
        PathUtils.listFiles(dir, silent = true, PathUtils.fileExtensionFilter(scanExtension))
      paths match {
        case Full(p) =>
          p.map(
            path =>
              LayerAttachment(FilenameUtils.removeExtension(path.getFileName.toString),
                              UPath.fromLocalPath(path),
                              dataFormat))
        case _ => Seq.empty
      }
    } else {
      Seq.empty
    }
  }

}

object MeshFileInfo {
  val directoryName = "meshes"
  private val scanDataFormat = LayerAttachmentDataformat.hdf5

  def scanForMeshFiles(layerDirectory: Path): Seq[LayerAttachment] =
    LayerAttachment.scanForFiles(layerDirectory, directoryName, scanDataFormat)
}

object AgglomerateFileInfo {
  val directoryName = "agglomerates"
  private val scanDataFormat = LayerAttachmentDataformat.hdf5

  def scanForAgglomerateFiles(layerDirectory: Path): Seq[LayerAttachment] =
    LayerAttachment.scanForFiles(layerDirectory, directoryName, scanDataFormat)
}

object SegmentIndexFileInfo {
  val directoryName = "segmentIndex"
  private val scanDataFormat = LayerAttachmentDataformat.hdf5

  def scanForSegmentIndexFile(layerDirectory: Path): Option[LayerAttachment] =
    LayerAttachment.scanForFiles(layerDirectory, directoryName, scanDataFormat).headOption
}

object ConnectomeFileInfo {
  val directoryName = "connectomes"
  private val scanDataFormat = LayerAttachmentDataformat.hdf5

  def scanForConnectomeFiles(layerDirectory: Path): Seq[LayerAttachment] =
    LayerAttachment.scanForFiles(layerDirectory, directoryName, scanDataFormat)
}

object CumsumFileInfo {
  val directoryName = "agglomerates"
  private val scanDataFormat = LayerAttachmentDataformat.json

  def scanForCumsumFile(layerDirectory: Path): Option[LayerAttachment] =
    LayerAttachment.scanForFiles(layerDirectory, directoryName, scanDataFormat).headOption
}
