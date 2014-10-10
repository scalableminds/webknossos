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

  lazy val nullFiles = Agent[Map[Int, Array[Byte]]](Map.empty)

  def loadNullBlock(dataSource: DataSource, dataLayer: DataLayer, useCache: Boolean): Array[Byte] = {
    val size = dataSource.blockSize * dataLayer.bytesPerElement
    if (useCache)
      nullFile(size)
    else
      new Array[Byte](size)
  }

  def nullFile(size: Int) =
    nullFiles().get(size).getOrElse{
      val nullFile = new Array[Byte](size)
      nullFiles send (_ + (size -> nullFile))
      nullFile
    }
}
