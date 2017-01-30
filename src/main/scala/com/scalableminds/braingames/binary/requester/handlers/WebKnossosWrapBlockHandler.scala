/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.requester.handlers

import com.scalableminds.braingames.binary.models._
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.concurrent.Execution.Implicits._
import play.api.Play.current
import play.api.i18n.Messages.Implicits._
import java.nio.file.Paths

import com.scalableminds.braingames.binary.requester.{CachedBlock, Cube, DataCache, DataCubeCache}
import com.scalableminds.util.cache.LRUConcurrentCache

import scala.concurrent.duration.FiniteDuration

class WebKnossosWrapCube(underlying: Array[Byte]) extends Cube{
  override def copyTo(offset: Long, other: Array[Byte], destPos: Int, length: Int): Boolean = {
    // TODO: FIX. convert to long !!!!!
    System.arraycopy(underlying, offset.toInt, other, destPos, length)
    true
  }
}

class WebKnossosWrapBlockHandler(val cache: DataCubeCache) extends BlockHandler
  with FoxImplicits
  with LazyLogging {

  override def loadFromUnderlying[T](loadBlock: LoadBlock, timeout: FiniteDuration)(f: Cube => T): Fox[T] = {
    val wkwDataSource = new WebKnossosWrapDataSource(Paths.get(loadBlock.dataSource.baseDir))

    for {
      layer <- wkwDataSource.getLayer(loadBlock.dataLayer.name) ?~> "Could not find webKnossosWrap layer."
      data <- layer.load(loadBlock)
    } yield {
      f(new WebKnossosWrapCube(data))
    }
  }

  def save(saveBlock: SaveBlock, timeout: FiniteDuration): Fox[Boolean] = {
    logger.error("WebKnossosWrap does not support saving data yet.")
    Fox.successful(false)
  }
}
