package com.scalableminds.webknossos.datastore.dataformats

import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import net.liftweb.common.Box

trait Cube {

  private var accessCounter = 0

  private var scheduledForRemoval = false

  private var isRemoved = false

  def cutOutBucket(dataLayer: DataLayer, bucket: BucketPosition): Box[Array[Byte]]

  def tryAccess(): Boolean =
    this.synchronized {
      if (isRemoved) {
        false
      } else {
        accessCounter += 1
        true
      }
    }

  def finishAccess(): Unit =
    // Check if we are the last one to use this cube, if that is the case and the cube needs to be removed -> remove it
    this.synchronized {
      accessCounter -= 1
      tryRemoval()
    }

  def scheduleForRemoval(): Unit =
    this.synchronized {
      scheduledForRemoval = true
      // Check if we can directly remove this cube (only possible if it is currently unused)
      tryRemoval()
    }

  private def tryRemoval(): Unit =
    // should only be called in a synchronized block
    if (!isRemoved && accessCounter == 0 && scheduledForRemoval) {
      isRemoved = true
      onFinalize()
    }

  protected def onFinalize(): Unit = {}
}
