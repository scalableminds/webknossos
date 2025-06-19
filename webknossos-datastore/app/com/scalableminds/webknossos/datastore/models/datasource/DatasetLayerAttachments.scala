package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.util.io.PathUtils
import net.liftweb.common.{Box, Full}
import org.apache.commons.io.FilenameUtils
import play.api.libs.json.{Format, Json}

import java.net.URI
import java.nio.file.{Files, Path}

case class DatasetLayerAttachments(
    meshes: Seq[LayerAttachment],
    agglomerates: Seq[LayerAttachment],
    segmentIndex: Option[LayerAttachment],
    connectomes: Seq[LayerAttachment],
    cumsum: Option[LayerAttachment]
) {
  def isEmpty: Boolean =
    meshes.isEmpty && agglomerates.isEmpty && segmentIndex.isEmpty && connectomes.isEmpty && cumsum.isEmpty
}

object DatasetLayerAttachments {
  implicit val jsonFormat: Format[DatasetLayerAttachments] = Json.format[DatasetLayerAttachments]
}

object LayerAttachmentDataFormat extends ExtendedEnumeration {
  type LayerAttachmentDataformat = Value
  val hdf5, json, zarr3 = Value
}

object LayerAttachmentType extends ExtendedEnumeration {
  type LayerAttachmentType = Value
  val mesh, agglomerate, segmentIndex, connectome, cumsum = Value
}

case class LayerAttachment(name: String, path: URI, dataFormat: LayerAttachmentDataFormat.LayerAttachmentDataformat)

object LayerAttachment {
  implicit val jsonFormat: Format[LayerAttachment] = Json.format[LayerAttachment]

  def scanForFiles(layerDirectory: Path,
                   directoryName: String,
                   dataFormat: LayerAttachmentDataFormat.LayerAttachmentDataformat): Seq[LayerAttachment] = {
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
  private val scanDataFormat = LayerAttachmentDataFormat.hdf5

  def scanForMeshFiles(layerDirectory: Path): Seq[LayerAttachment] =
    LayerAttachment.scanForFiles(layerDirectory, directoryName, scanDataFormat)
}

object AgglomerateFileInfo {
  val directoryName = "agglomerates"
  private val scanDataFormat = LayerAttachmentDataFormat.hdf5

  def scanForAgglomerateFiles(layerDirectory: Path): Seq[LayerAttachment] =
    LayerAttachment.scanForFiles(layerDirectory, directoryName, scanDataFormat)
}

object SegmentIndexFileInfo {
  val directoryName = "segmentIndex"
  private val scanDataFormat = LayerAttachmentDataFormat.hdf5

  def scanForSegmentIndexFile(layerDirectory: Path): Option[LayerAttachment] =
    LayerAttachment.scanForFiles(layerDirectory, directoryName, scanDataFormat).headOption
}

object ConnectomeFileInfo {
  val directoryName = "connectomes"
  private val scanDataFormat = LayerAttachmentDataFormat.hdf5

  def scanForConnectomeFiles(layerDirectory: Path): Seq[LayerAttachment] =
    LayerAttachment.scanForFiles(layerDirectory, directoryName, scanDataFormat)
}

object CumsumFileInfo {
  val directoryName = "agglomerates"
  private val scanDataFormat = LayerAttachmentDataFormat.json

  def scanForCumsumFile(layerDirectory: Path): Option[LayerAttachment] =
    LayerAttachment.scanForFiles(layerDirectory, directoryName, scanDataFormat).headOption
}
