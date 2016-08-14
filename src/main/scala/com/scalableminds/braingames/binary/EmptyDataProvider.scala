/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary

import com.scalableminds.braingames.binary.models.{DataLayer, DataSource}

trait EmptyDataProvider {

  lazy val nullFiles = scala.collection.concurrent.TrieMap.empty[Int, Array[Byte]]

  def loadNullBlock(dataSource: DataSource, dataLayer: DataLayer, useCache: Boolean): Array[Byte] = {
    val size = dataSource.blockSize * dataLayer.bytesPerElement
    if (useCache)
      nullFile(size)
    else
      new Array[Byte](size)
  }

  def nullFile(size: Int) =
    nullFiles.getOrElseUpdate(size, new Array[Byte](size))
}
