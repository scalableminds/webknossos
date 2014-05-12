/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.api

import com.scalableminds.util.geometry.{Vector3D, Point3D}
import com.scalableminds.braingames.binary.{DataRequestSettings, Cuboid}
import com.scalableminds.braingames.binary.{ParsedDataReadRequest, ParsedDataWriteRequest, DataReadRequest, DataWriteRequest}
import com.scalableminds.braingames.binary.models.{DataLayer, DataSource}

trait BinaryDataHelpers {

  def resolutionFromExponent(resolutionExponent: Int) =
    math.pow(2, resolutionExponent).toInt

  def createDataReadRequest(dataSource: DataSource, dataLayer: DataLayer, dataSection: Option[String], width: Int, height: Int, depth: Int, parsed: ParsedDataReadRequest): DataReadRequest = {
    val settings = DataRequestSettings(
      useHalfByte = parsed.useHalfByte,
      skipInterpolation = false
    )
    createDataReadRequest(dataSource, dataLayer, dataSection, width, height, depth, parsed.position, parsed.resolutionExponent, settings)
  }

  def createDataReadRequest(dataSource: DataSource, dataLayer: DataLayer, dataSection: Option[String], cubeSize: Int, parsed: ParsedDataReadRequest): DataReadRequest = {
    createDataReadRequest(dataSource, dataLayer, dataSection, cubeSize, cubeSize, cubeSize, parsed)
  }

  def createDataReadRequest(dataSource: DataSource, dataLayer: DataLayer, dataSection: Option[String], width: Int, height: Int, depth: Int, position: Point3D, resolutionExponent: Int, settings: DataRequestSettings) = {
    val resolution = resolutionFromExponent(resolutionExponent)
    val cuboid = Cuboid(width, height, depth,  resolution, Some(Vector3D(position)))

    DataReadRequest(
      dataSource,
      dataLayer,
      dataSection,
      resolution,
      cuboid,
      settings)
  }

  def createDataWriteRequest(dataSource: DataSource, dataLayer: DataLayer, dataSection: Option[String], cubeSize: Int, r: ParsedDataWriteRequest): DataWriteRequest = {
    createDataWriteRequest(dataSource, dataLayer, dataSection, cubeSize, cubeSize, cubeSize, r.position, r.resolutionExponent, r.data)
  }

  def createDataWriteRequest(dataSource: DataSource, dataLayer: DataLayer, dataSection: Option[String], width: Int, height: Int, depth: Int, position: Point3D, resolutionExponent: Int, data: Array[Byte]) = {
    val resolution = resolutionFromExponent(resolutionExponent)
    val cuboid = Cuboid(width, height, depth,  resolution, Some(Vector3D(position)))

    DataWriteRequest(
      dataSource,
      dataLayer,
      dataSection,
      resolution,
      cuboid,
      data)
  }
}
