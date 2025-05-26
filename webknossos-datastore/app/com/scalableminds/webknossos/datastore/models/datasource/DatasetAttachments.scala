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
}

object MeshFileInfo {
  implicit val jsonFormat: Format[AttachedFile] = Json.format[AttachedFile]

  val directoryName = "meshes"
  private val scanExtension = "hdf5"
  val typ = "mesh"

  def scanForMeshFiles(layerDirectory: Path): Seq[AttachedFile] = {
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
}

object AgglomerateFileInfo {
  implicit val jsonFormat: Format[AttachedFile] = Json.format[AttachedFile]

  val directoryName = "agglomerates"
  private val scanExtension = "hdf5"
  val typ = "agglomerate"

  def scanForAgglomerateFiles(layerDirectory: Path): Seq[AttachedFile] = {
    val dir = layerDirectory.resolve(directoryName)
    if (Files.exists(dir)) {
      val agglomerateFilePaths: Box[List[Path]] =
        PathUtils.listFiles(dir, silent = true, PathUtils.fileExtensionFilter(scanExtension))
      agglomerateFilePaths match {
        case Full(p) =>
          p.map(path => AttachedFile(path.toUri, scanExtension))
        case _ => Seq.empty
      }
    } else {
      Seq.empty
    }
  }
}

object SegmentIndexFileInfo {
  implicit val jsonFormat: Format[AttachedFile] = Json.format[AttachedFile]

  val directoryName = "segmentIndex"
  private val scanExtension = "hdf5"
  val typ = "segmentIndex"

  def scanForSegmentIndexFiles(layerDirectory: Path): Option[AttachedFile] = {
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

object ConnectomeFileInfo {
  implicit val jsonFormat: Format[AttachedFile] = Json.format[AttachedFile]

  val directoryName = "connectomes"
  private val scanExtension = "hdf5"
  val typ = "connectome"

  def scanForConnectomeFiles(layerDirectory: Path): Seq[AttachedFile] = {
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
}

object CumsumFileInfo {
  implicit val jsonFormat: Format[AttachedFile] = Json.format[AttachedFile]

  val directoryName = "agglomerates"
  private val scanExtension = "json"
  val typ = "cumsum"

  def scanForCumsumFiles(layerDirectory: Path): Option[AttachedFile] = {
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
