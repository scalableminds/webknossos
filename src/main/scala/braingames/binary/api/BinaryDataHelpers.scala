package braingames.binary.api

import braingames.geometry.{Vector3D, Point3D}
import braingames.binary.{DataRequestSettings, Cuboid}
import braingames.binary.{ParsedDataReadRequest, ParsedDataWriteRequest, DataReadRequest, DataWriteRequest}
import braingames.binary.models.{DataLayer, DataSet}

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 04.08.13
 * Time: 20:04
 */
trait BinaryDataHelpers {

  def resolutionFromExponent(resolutionExponent: Int) =
    math.pow(2, resolutionExponent).toInt

  def createDataReadRequest(dataSet: DataSet, dataLayer: DataLayer, dataSection: Option[String], width: Int, height: Int, depth: Int, parsed: ParsedDataReadRequest): DataReadRequest = {
    val settings = DataRequestSettings(
      useHalfByte = parsed.useHalfByte,
      skipInterpolation = false
    )
    createDataReadRequest(dataSet, dataLayer, dataSection, width, height, depth, parsed.position, parsed.resolutionExponent, settings)
  }

  def createDataReadRequest(dataSet: DataSet, dataLayer: DataLayer, dataSection: Option[String], cubeSize: Int, parsed: ParsedDataReadRequest): DataReadRequest = {
    createDataReadRequest(dataSet, dataLayer, dataSection, cubeSize, cubeSize, cubeSize, parsed)
  }

  def createDataReadRequest(dataSet: DataSet, dataLayer: DataLayer, dataSection: Option[String], width: Int, height: Int, depth: Int, position: Point3D, resolutionExponent: Int, settings: DataRequestSettings) = {
    val resolution = resolutionFromExponent(resolutionExponent)
    val cuboid = Cuboid(width, height, depth,  resolution, Some(Vector3D(position)))

    DataReadRequest(
      dataSet,
      dataLayer,
      dataSection,
      resolution,
      cuboid,
      settings)
  }

  def createDataWriteRequest(dataSet: DataSet, dataLayer: DataLayer, dataSection: Option[String], cubeSize: Int, r: ParsedDataWriteRequest): DataWriteRequest = {
    createDataWriteRequest(dataSet, dataLayer, dataSection, cubeSize, cubeSize, cubeSize, r.position, r.resolutionExponent, r.data)
  }

  def createDataWriteRequest(dataSet: DataSet, dataLayer: DataLayer, dataSection: Option[String], width: Int, height: Int, depth: Int, position: Point3D, resolutionExponent: Int, data: Array[Byte]) = {
    val resolution = resolutionFromExponent(resolutionExponent)
    val cuboid = Cuboid(width, height, depth,  resolution, Some(Vector3D(position)))

    DataWriteRequest(
      dataSet,
      dataLayer,
      dataSection,
      resolution,
      cuboid,
      data)
  }
}
