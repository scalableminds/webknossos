/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.requester.handlers

import com.scalableminds.braingames.binary.models._
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.wrap.WebKnossosWrapDataSource
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.concurrent.Execution.Implicits._
import play.api.Play.current
import play.api.i18n.Messages.Implicits._
import java.nio.file.Paths
import scala.concurrent.duration.FiniteDuration

class WebKnossosWrapBlockHandler extends BlockHandler
  with FoxImplicits
  with LazyLogging {

  def load(loadBlock: LoadBlock, timeout: FiniteDuration): Fox[Array[Byte]] = {
    val wkwDataSource = new WebKnossosWrapDataSource(Paths.get(loadBlock.dataSource.baseDir))

    for {
      layer <- wkwDataSource.getLayer(loadBlock.dataLayer.name) ?~> "Could not find webKnossosWrap layer."
      data <- layer.load(loadBlock)
    } yield {
      data
    }
  }

  def save(saveBlock: SaveBlock, timeout: FiniteDuration): Fox[Boolean] = {
    logger.error("WebKnossosWrap does not support saving data yet.")
    Fox.successful(false)
  }
}
