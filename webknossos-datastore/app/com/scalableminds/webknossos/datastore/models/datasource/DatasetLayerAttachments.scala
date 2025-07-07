package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.util.io.PathUtils
import com.scalableminds.util.tools.{Box, Full}
import com.scalableminds.webknossos.datastore.storage.DataVaultService
import org.apache.commons.io.FilenameUtils
import play.api.libs.json.{Format, Json}

import java.net.URI
import java.nio.file.{Files, Path}

case class DatasetLayerAttachments(
    meshes: Seq[LayerAttachment] = Seq.empty,
    agglomerates: Seq[LayerAttachment] = Seq.empty,
    segmentIndex: Option[LayerAttachment] = None,
    connectomes: Seq[LayerAttachment] = Seq.empty,
    cumsum: Option[LayerAttachment] = None
) {
  def allAttachments: Seq[LayerAttachment] = meshes ++ agglomerates ++ segmentIndex ++ connectomes ++ cumsum
  def isEmpty: Boolean = allAttachments.isEmpty
}

object DatasetLayerAttachments {
  implicit val jsonFormat: Format[DatasetLayerAttachments] =
    Json.using[Json.WithDefaultValues].format[DatasetLayerAttachments]
}

object LayerAttachmentDataformat extends ExtendedEnumeration {
  type LayerAttachmentDataformat = Value
  val hdf5, json, zarr3, neuroglancerPrecomputed = Value
}

object LayerAttachmentType extends ExtendedEnumeration {
  type LayerAttachmentType = Value
  val mesh, agglomerate, segmentIndex, connectome, cumsum = Value
}

case class LayerAttachment(name: String,
                           path: URI,
                           dataFormat: LayerAttachmentDataformat.LayerAttachmentDataformat,
                           credentialId: Option[String] = None) {
  // Warning: throws! Use inside of tryo
  def localPath: Path = {
    if (path.getScheme != null && path.getScheme.nonEmpty && path.getScheme != DataVaultService.schemeFile) {
      throw new Exception(
        "Trying to open non-local hdf5 file. Hdf5 files are only supported on the datastore-local file system.")
    }
    Path.of(path)
  }
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
          p.map(path =>
            LayerAttachment(FilenameUtils.removeExtension(path.getFileName.toString), path.toUri, dataFormat))
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
