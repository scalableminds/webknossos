/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.requester.handlers

import com.scalableminds.braingames.binary.models._
import com.scalableminds.util.tools.Fox
import scala.concurrent.duration.FiniteDuration

trait BlockHandler {
  def load(loadBlock: LoadBlock, timeout: FiniteDuration): Fox[Array[Byte]]

  def save(saveBlock: SaveBlock, timeout: FiniteDuration): Fox[Boolean]
}
