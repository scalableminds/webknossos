/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.api

import com.scalableminds.braingames.binary.requester.Cuboid
import com.scalableminds.braingames.binary.models._
import com.scalableminds.braingames.binary.models.{DataRequestSettings, DataWriteRequest}
import com.scalableminds.util.geometry.Point3D

trait BinaryDataRequestBuilder {

  def createDataReadRequest(
                             dataSource: DataSource,
                             dataLayer: DataLayer,
                             dataSection: Option[String],
                             width: Int,
                             height: Int,
                             depth: Int,
                             position: VoxelPosition,
                             settings: DataRequestSettings): DataReadRequest = {

    val cuboid = Cuboid(position, width, height, depth)
    DataReadRequest(dataSource, dataLayer, dataSection, cuboid, settings)
  }

  def createDataWriteRequest(
                              dataSource: DataSource,
                              dataLayer: DataLayer,
                              dataSection: Option[String],
                              width: Int,
                              height: Int,
                              depth: Int,
                              position: VoxelPosition,
                              version: Long,
                              data: Array[Byte]): DataWriteRequest = {

    val cuboid = Cuboid(position, width, height, depth)
    DataWriteRequest(dataSource, dataLayer, dataSection, cuboid, version, data)
  }
}
