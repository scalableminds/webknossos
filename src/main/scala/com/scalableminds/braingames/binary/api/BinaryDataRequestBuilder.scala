/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.api

import com.scalableminds.braingames.binary.requester.Cuboid
import com.scalableminds.braingames.binary.models._
import com.scalableminds.braingames.binary.models.{DataRequestSettings, DataWriteRequest}
import com.scalableminds.util.geometry.Point3D

trait BinaryDataRequestBuilder {

  private def resolutionFromExponent(resolutionExponent: Int) =
    math.pow(2, resolutionExponent).toInt

  def createDataReadRequest(
                             dataSource: DataSource,
                             dataLayer: DataLayer,
                             dataSection: Option[String],
                             width: Int,
                             height: Int,
                             depth: Int,
                             position: Point3D,
                             resolutionExponent: Int,
                             settings: DataRequestSettings): DataReadRequest = {

    val resolution = resolutionFromExponent(resolutionExponent)
    val cuboid = Cuboid(width, height, depth, resolution, position)

    DataReadRequest(dataSource, dataLayer, dataSection, resolution, cuboid, settings)
  }

  def createDataWriteRequest(
                              dataSource: DataSource,
                              dataLayer: DataLayer,
                              dataSection: Option[String],
                              width: Int,
                              height: Int,
                              depth: Int,
                              position: Point3D,
                              resolutionExponent: Int,
                              data: Array[Byte]): DataWriteRequest = {

    val resolution = resolutionFromExponent(resolutionExponent)
    val cuboid = Cuboid(width, height, depth, resolution, position)

    DataWriteRequest(dataSource, dataLayer, dataSection, resolution, cuboid, data)
  }
}
