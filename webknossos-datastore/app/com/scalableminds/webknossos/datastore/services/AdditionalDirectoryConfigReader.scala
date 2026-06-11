package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.tools.ConfigReader
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.typesafe.config.Config
import play.api.Configuration

class AdditionalDirectoryConfigReader(underlyingConfig: Config) extends ConfigReader {
  override val raw: Configuration = Configuration(underlyingConfig)

  def getAdditionalDirectory: Option[AdditionalDirectoryConfig] =
    for {
      pathStr <- getOptional[String]("path")
      path <- UPath.fromString(pathStr).toOption
      allowsUpload <- getOptional[Boolean]("allowsUpload")
      doScan <- getOptional[Boolean]("doScan")
    } yield
      AdditionalDirectoryConfig(
        path.toAbsolute,
        getOptional[String]("organizationId"),
        allowsUpload,
        doScan,
        getOptional[String]("uploadPrefix")
      )
}
