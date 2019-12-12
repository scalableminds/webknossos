package com.scalableminds.util.tools

import play.api.{ConfigLoader, Configuration}

trait ConfigReader {
  def raw: Configuration

  def get[A](path: String)(implicit loader: ConfigLoader[A]): A =
    raw.get[A](path)

  def getOptional[A](path: String)(implicit loader: ConfigLoader[A]): Option[A] =
    raw.getOptional[A](path)
}
