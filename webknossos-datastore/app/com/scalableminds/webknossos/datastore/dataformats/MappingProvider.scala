package com.scalableminds.webknossos.datastore.dataformats

import java.nio.file.Path

import com.scalableminds.webknossos.datastore.models.datasource.SegmentationLayer
import com.scalableminds.webknossos.datastore.models.requests.MappingReadInstruction
import com.scalableminds.util.io.{FileIO, PathUtils}
import net.liftweb.common.Box
import org.apache.commons.io.FilenameUtils

class MappingProvider(layer: SegmentationLayer) {

  def load(readInstruction: MappingReadInstruction): Box[Array[Byte]] = {
    val mappingFile = readInstruction.baseDir
      .resolve(readInstruction.dataSource.id.team)
      .resolve(readInstruction.dataSource.id.name)
      .resolve(layer.name)
      .resolve(MappingProvider.mappingsDir)
      .resolve(s"${readInstruction.mapping}.${MappingProvider.mappingFileExtension}")
      .toFile
    FileIO.readFileToByteArray(mappingFile)
  }

}

object MappingProvider {

  val mappingsDir = "mappings"

  val mappingFileExtension = "json"

  def exploreMappings(layerDir: Path): Set[String] = {
    PathUtils.listFiles(
      layerDir.resolve(MappingProvider.mappingsDir),
      PathUtils.fileExtensionFilter(MappingProvider.mappingFileExtension)).map {
      paths => paths.map(path => FilenameUtils.removeExtension(path.getFileName.toString))
    }.getOrElse(Nil).toSet
  }
}
