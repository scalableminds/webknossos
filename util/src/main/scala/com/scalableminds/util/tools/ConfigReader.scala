package com.scalableminds.util.tools

import com.scalableminds.util.time.Instant
import com.typesafe.config.Config
import play.api.{ConfigLoader, Configuration}

trait ConfigReader {
  def raw: Configuration

  implicit val instantConfigLoader: ConfigLoader[Instant] = new ConfigLoader[Instant] {
    def load(rootConfig: Config, path: String): Instant = {
      val literal = rootConfig.getString(path)
      Instant.fromString(literal).get
    }
  }

  def get[A](path: String)(implicit loader: ConfigLoader[A]): A =
    raw.get[A](path)

  def getOptional[A](path: String)(implicit loader: ConfigLoader[A]): Option[A] =
    raw.getOptional[A](path)

  def getList[A](path: String)(implicit loader: ConfigLoader[Seq[A]]): List[A] =
    raw.get[Seq[A]](path).toList
}
