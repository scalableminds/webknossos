/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary

import akka.agent.Agent
import akka.actor.ActorSystem
import com.scalableminds.braingames.binary.models.DataLayer
import com.scalableminds.braingames.binary.models.DataSource
import scala.concurrent.ExecutionContext.Implicits._

trait EmptyDataProvider {
  implicit val sys: ActorSystem

  lazy val nullFiles = Agent[Map[(Int, Int), Array[Byte]]](Map.empty)

  def loadNullBlock(dataSource: DataSource, dataLayer: DataLayer): Array[Byte] = {
    nullFile(dataSource.blockSize, dataLayer.bytesPerElement)
  }

  def createNullArray(blockSize: Int, bytesPerElement: Int) =
    new Array[Byte](blockSize * bytesPerElement)

  def nullFile(blockSize: Int, bytesPerElement: Int) =
    createNullArray(blockSize, bytesPerElement)
}
