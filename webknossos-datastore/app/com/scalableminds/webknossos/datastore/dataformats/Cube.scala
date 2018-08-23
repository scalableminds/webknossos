/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.dataformats

import com.newrelic.api.agent.NewRelic
import com.scalableminds.webknossos.datastore.models.BucketPosition
import com.scalableminds.webknossos.datastore.models.datasource.DataLayer
import net.liftweb.common.Box

trait Cube {

  private var accessCounter = 0

  private var scheduledForRemoval = false

  private var isRemoved = false

  def cutOutBucket(dataLayer: DataLayer, bucket: BucketPosition): Box[Array[Byte]]

  def tryAccess(): Boolean = {
    this.synchronized {
      if (isRemoved) {
        NewRelic.noticeError("Tried to access cube which is already removed.")
        false
      } else {
        accessCounter += 1
        true
      }
    }
  }

  def finishAccess(): Unit = {
    // Check if we are the last one to use this cube, if that is the case and the cube needs to be removed -> remove it
    this.synchronized {
      accessCounter -= 1
      if (accessCounter == 0 && scheduledForRemoval) {
        onFinalize()
      }
    }
  }

  def scheduleForRemoval(): Unit = {
    this.synchronized {
      scheduledForRemoval = true
      // Check if we can directly remove this cube (only possible if it is currently unused)
      if (accessCounter == 0) {
        isRemoved = true
        onFinalize()
      }
    }
  }

  protected def onFinalize(): Unit = {}
}
