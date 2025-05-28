package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.util.io.PathUtils
import net.liftweb.common.{Box, Full}
import play.api.libs.json.{Format, Json}

import java.net.URI
import java.nio.file.{Files, Path}

case class DatasetAttachments(
    meshes: Seq[AttachedFile],
    agglomerates: Seq[AttachedFile],
    segmentIndex: Option[AttachedFile],
    connectomes: Seq[AttachedFile],
    cumsum: Option[AttachedFile]
)

object DatasetAttachments {
  implicit val jsonFormat: Format[DatasetAttachments] = Json.format[DatasetAttachments]
}

case class AttachedFile(path: URI, dataFormat: String)

object AttachedFile {
  implicit val jsonFormat: Format[AttachedFile] = Json.format[AttachedFile]

  def scanForFiles(layerDirectory: Path, directoryName: String, scanExtension: String): Seq[AttachedFile] = {
    val dir = layerDirectory.resolve(directoryName)
    if (Files.exists(dir)) {
      val paths: Box[List[Path]] =
        PathUtils.listFiles(dir, silent = true, PathUtils.fileExtensionFilter(scanExtension))
      paths match {
        case Full(p) => p.map(path => AttachedFile(path.toUri, scanExtension))
        case _       => Seq.empty
      }
    } else {
      Seq.empty
    }
  }

  def scanForSingleFile(layerDirectory: Path, directoryName: String, scanExtension: String): Option[AttachedFile] = {
    val dir = layerDirectory.resolve(directoryName)
    if (Files.exists(dir)) {
      val paths: Box[List[Path]] =
        PathUtils.listFiles(dir, silent = true, PathUtils.fileExtensionFilter(scanExtension))
      paths match {
        case Full(p) if p.nonEmpty =>
          Some(AttachedFile(p.head.toUri, scanExtension))
        case _ => None
      }
    } else {
      None
    }
  }
}

object MeshFileInfo {

  val directoryName = "meshes"
  private val scanExtension = "hdf5"
  val typ = "mesh"

  def scanForMeshFiles(layerDirectory: Path): Seq[AttachedFile] =
    AttachedFile.scanForFiles(layerDirectory, directoryName, scanExtension)
}

object AgglomerateFileInfo {

  val directoryName = "agglomerates"
  private val scanExtension = "hdf5"
  val typ = "agglomerate"

  def scanForAgglomerateFiles(layerDirectory: Path): Seq[AttachedFile] = AttachedFile.scanForFiles(
    layerDirectory,
    directoryName,
    scanExtension
  )
}

object SegmentIndexFileInfo {
  val directoryName = "segmentIndex"
  private val scanExtension = "hdf5"
  val typ = "segmentIndex"

  def scanForSegmentIndexFile(layerDirectory: Path): Option[AttachedFile] = AttachedFile.scanForSingleFile(
    layerDirectory,
    directoryName,
    scanExtension
  )
}

object ConnectomeFileInfo {
  val directoryName = "connectomes"
  private val scanExtension = "hdf5"
  val typ = "connectome"

  def scanForConnectomeFiles(layerDirectory: Path): Seq[AttachedFile] = AttachedFile.scanForFiles(
    layerDirectory,
    directoryName,
    scanExtension
  )
}

object CumsumFileInfo {
  val directoryName = "agglomerates"
  private val scanExtension = "json"
  val typ = "cumsum"

  def scanForCumsumFile(layerDirectory: Path): Option[AttachedFile] = AttachedFile.scanForSingleFile(
    layerDirectory,
    directoryName,
    scanExtension
  )
}
