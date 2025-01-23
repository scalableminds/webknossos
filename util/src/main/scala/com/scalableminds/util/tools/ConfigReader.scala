package com.scalableminds.util.tools

import com.scalableminds.util.time.Instant
import com.typesafe.config.Config
import play.api.{ConfigLoader, Configuration}

import scala.util.control.NonFatal

trait ConfigReader {
  def raw: Configuration

  implicit val instantConfigLoader: ConfigLoader[Instant] = (rootConfig: Config, path: String) => {
    val literal = rootConfig.getString(path)
    try {
      Instant.fromString(literal).get
    } catch {
      case NonFatal(_) =>
        throw new IllegalArgumentException(
          s"Cannot read config value “$literal” for $path as Instant. Expected ISO date like “2023-01-01T00:00:00Z”")
    }
  }

  def get[A](path: String)(implicit loader: ConfigLoader[A]): A =
    raw.get[A](path)

  def getOptional[A](path: String)(implicit loader: ConfigLoader[A]): Option[A] =
    raw.getOptional[A](path)

  def getList[A](path: String)(implicit loader: ConfigLoader[Seq[A]]): List[A] =
    raw.get[Seq[A]](path).toList
}
