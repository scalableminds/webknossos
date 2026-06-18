package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.tools.ConfigReader
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.typesafe.config.{Config, ConfigException}
import play.api.Configuration

case class BaseDirConfig(
  path: UPath,
  organizationId: Option[String],
  allowsUpload: Boolean,
  doScan: Boolean
)

class BaseDirConfigReader {

  def read(rawConfigs: List[Config]): List[BaseDirConfig] = {
    val baseDirConfigs = rawConfigs.flatMap { rawConfig =>
      new SingleBaseDirConfigReader(rawConfig).readOne
    }
    if (baseDirConfigs.forall(c => c.doScan && c.path.isRemote))
      throw new ConfigException.BadValue("datastore.baseDirectories", "Cannot enable doScan on remote paths.")
    for {
      a <- baseDirConfigs
      b <- baseDirConfigs
      if a.path != b.path && a.path.startsWith(b.path)
    } throw new ConfigException.BadValue(
      "datastore.baseDirectories",
      s"Configured path ${a.path} is a subpath of ${b.path}. Configured base directories must not be nested.")
    baseDirConfigs
  }

}

class SingleBaseDirConfigReader(underlyingConfig: Config) extends ConfigReader {
  override val raw: Configuration = Configuration(underlyingConfig)

  def readOne: Option[BaseDirConfig] =
    for {
      pathStr <- getOptional[String]("path")
      path <- UPath.fromString(pathStr).toOption
      allowsUpload <- getOptional[Boolean]("allowsUpload")
      doScan <- getOptional[Boolean]("doScan")
    } yield
      BaseDirConfig(
        path.toAbsolute,
        getOptional[String]("organizationId"),
        allowsUpload,
        doScan
      )
}
