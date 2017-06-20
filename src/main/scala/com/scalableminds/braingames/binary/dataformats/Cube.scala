/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.dataformats

import java.util.concurrent.atomic.{AtomicBoolean, AtomicInteger}

import com.scalableminds.braingames.binary.models.BucketPosition
import com.scalableminds.braingames.binary.models.datasource.DataLayer
import com.scalableminds.braingames.binary.models.requests.CubeLoadInstruction
import com.scalableminds.util.tools.Fox
import net.liftweb.common.Box

trait Cube {

  private val accessCounter = new AtomicInteger()

  private val scheduledForRemoval = new AtomicBoolean()

  def cutOutBucket(dataLayer: DataLayer, bucket: BucketPosition): Box[Array[Byte]]

  def startAccess(): Unit = {
    accessCounter.incrementAndGet()
  }

  def finishAccess(): Unit = {
    // Check if we are the last one to use this cube, if that is the case and the cube needs to be removed -> remove it
    val currentUsers = accessCounter.decrementAndGet()
    if(currentUsers == 0 && scheduledForRemoval.get()) {
      onFinalize()
    }
  }

  def scheduleForRemoval(): Unit = {
    scheduledForRemoval.set(true)
    // Check if we can directly remove this cube (only possible if it is currently unused)
    if(accessCounter.get() == 0) {
      onFinalize()
    }
  }

  protected def onFinalize(): Unit = {}
}

trait CubeLoader {
  def load(cubeInstruction: CubeLoadInstruction): Fox[Cube]
}
