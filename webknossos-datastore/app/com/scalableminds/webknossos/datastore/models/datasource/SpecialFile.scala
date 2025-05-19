package com.scalableminds.webknossos.datastore.models.datasource

import com.scalableminds.util.io.PathUtils
import net.liftweb.common.{Box, Full}
import play.api.libs.json.{Format, Json}

import java.net.URI
import java.nio.file.{Files, Path}

case class SpecialFiles(
    meshes: Seq[MeshFileInfo],
    agglomerates: Seq[AgglomerateFileInfo],
    segmentIndex: Option[SegmentIndexFileInfo],
    connectomes: Seq[ConnectomeFileInfo]
)

object SpecialFiles {
  implicit val jsonFormat: Format[SpecialFiles] = Json.format[SpecialFiles]
}

case class MeshFileInfo(
    source: URI,
    dataFormat: String,
)

object MeshFileInfo {
  implicit val jsonFormat: Format[MeshFileInfo] = Json.format[MeshFileInfo]

  val directoryName = "meshes"
  val scanExtension = "hdf5"
  val typ = "mesh"

  def scanForMeshFiles(layerDirectory: Path): Seq[MeshFileInfo] = {
    val dir = layerDirectory.resolve(directoryName)
    if (Files.exists(dir)) {
      val paths: Box[List[Path]] =
        PathUtils.listFiles(dir, silent = true, PathUtils.fileExtensionFilter(scanExtension))
      paths match { // TODO: Relativize path
        case Full(p) => p.map(path => MeshFileInfo(path.toUri, scanExtension))
        case _       => Seq.empty
      }
    } else {
      Seq.empty
    }
  }
}

case class AgglomerateFileInfo(
    source: URI,
    dataFormat: String,
    cumsumSource: Option[URI]
)

object AgglomerateFileInfo {
  implicit val jsonFormat: Format[AgglomerateFileInfo] = Json.format[AgglomerateFileInfo]

  val directoryName = "agglomerates"
  val scanExtension = "hdf5"
  val cumsumFileExtension = "json"
  val typ = "agglomerate"

  def scanForAgglomerateFiles(layerDirectory: Path): Seq[AgglomerateFileInfo] = {
    val dir = layerDirectory.resolve(directoryName)
    if (Files.exists(dir)) {
      val cumsumFile =
        PathUtils.listFiles(dir, silent = true, PathUtils.fileExtensionFilter(cumsumFileExtension)) match {
          case Full(jsonFiles) =>
            jsonFiles.headOption.map(_.toUri)
          case _ => None
        }
      val agglomerateFilePaths: Box[List[Path]] =
        PathUtils.listFiles(dir, silent = true, PathUtils.fileExtensionFilter(scanExtension))
      agglomerateFilePaths match { // TODO: Relativize path
        case Full(p) =>
          p.map(path => AgglomerateFileInfo(path.toUri, scanExtension, cumsumFile))
        case _ => Seq.empty
      }
    } else {
      Seq.empty
    }
  }
}

case class SegmentIndexFileInfo(
    source: URI,
    dataFormat: String,
)

object SegmentIndexFileInfo {
  implicit val jsonFormat: Format[SegmentIndexFileInfo] = Json.format[SegmentIndexFileInfo]

  val directoryName = "segmentIndex"
  val scanExtension = "hdf5"
  val typ = "segmentIndex"

  def scanForSegmentIndexFiles(layerDirectory: Path): Option[SegmentIndexFileInfo] = {
    val dir = layerDirectory.resolve(directoryName)
    if (Files.exists(dir)) {
      val paths: Box[List[Path]] =
        PathUtils.listFiles(dir, silent = true, PathUtils.fileExtensionFilter(scanExtension))
      paths match {
        case Full(p) if p.nonEmpty =>
          Some(SegmentIndexFileInfo(p.head.toUri, scanExtension))
        case _ => None
      }
    } else {
      None
    }
  }
}

case class ConnectomeFileInfo(
    source: URI,
    dataFormat: String,
)

object ConnectomeFileInfo {
  implicit val jsonFormat: Format[ConnectomeFileInfo] = Json.format[ConnectomeFileInfo]

  val directoryName = "connectomes"
  val scanExtension = "hdf5"
  val typ = "connectome"

  def scanForConnectomeFiles(layerDirectory: Path): Seq[ConnectomeFileInfo] = {
    val dir = layerDirectory.resolve(directoryName)
    if (Files.exists(dir)) {
      val paths: Box[List[Path]] =
        PathUtils.listFiles(dir, silent = true, PathUtils.fileExtensionFilter(scanExtension))
      paths match {
        case Full(p) => p.map(path => ConnectomeFileInfo(path.toUri, scanExtension))
        case _       => Seq.empty
      }
    } else {
      Seq.empty
    }
  }
}
