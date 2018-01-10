/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.binary.dataformats

import java.nio.file.Path

import com.scalableminds.webknossos.datastore.binary.models.datasource.SegmentationLayer
import com.scalableminds.webknossos.datastore.binary.models.requests.MappingReadInstruction
import com.scalableminds.util.io.FileIO
import net.liftweb.common.Box

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
}
