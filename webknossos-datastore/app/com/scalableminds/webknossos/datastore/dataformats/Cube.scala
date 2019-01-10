package com.scalableminds.webknossos.datastore.dataformats

import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import net.liftweb.common.Box
import java.util.concurrent.atomic.{AtomicBoolean, AtomicInteger}

trait Cube {

  //private var accessCounter = 0
  private val accessCounter = new AtomicInteger()

  //private var scheduledForRemoval = false
  private val scheduledForRemoval = new AtomicBoolean()

  //private var isRemoved = false

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

  private def tryRemoval(): Unit = {
    // should only be called in a synchronized block
    if (accessCounter.get() == 0) {
      onFinalize()
    }
  }

  protected def onFinalize(): Unit = {}
}
