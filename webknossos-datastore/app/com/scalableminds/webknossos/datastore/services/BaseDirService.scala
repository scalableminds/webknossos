package com.scalableminds.webknossos.datastore.services

import com.scalableminds.webknossos.datastore.DataStoreConfig
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.typesafe.scalalogging.LazyLogging
import jakarta.inject.Inject

import java.nio.file.Path

case class AdditionalDirectoryConfig(
    path: UPath,
    organizationId: String,
    allowsUpload: Boolean,
    doScan: Boolean,
    uploadPrefix: Option[String]
)

class BaseDirService @Inject()(config: DataStoreConfig) extends LazyLogging {
  private val baseDir: Path = config.Datastore.baseDirectory

  private lazy val additionalDirectories: Seq[AdditionalDirectoryConfig] = {
    val res = config.Datastore.additionalDirectories.flatMap { dirConfig =>
      new AdditionalDirectoryConfigReader(dirConfig).getAdditionalDirectory
    }
    logger.info(s"Parsed ${res.length} additional directories from datastore config.")
    res
  }
}
