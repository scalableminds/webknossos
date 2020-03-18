package com.scalableminds.webknossos.datastore.dataformats

import java.nio.file.Path

import com.scalableminds.util.io.PathUtils
import org.apache.commons.io.FilenameUtils

object AgglomerateProvider {

  val agglomerateDir = "agglomerates"

  val agglomerateFileExtension = "hdf5"

  def exploreAgglomerates(layerDir: Path): Set[String] =
    PathUtils
      .listFiles(layerDir.resolve(agglomerateDir), PathUtils.fileExtensionFilter(agglomerateFileExtension))
      .map { paths =>
        paths.map(path => FilenameUtils.removeExtension(path.getFileName.toString))
      }
      .getOrElse(Nil)
      .toSet
}
