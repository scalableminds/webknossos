package braingames.binary.api

import braingames.geometry.{Vector3D, Point3D}
import braingames.binary.{DataRequestSettings, ParsedRequest, DataRequest, Cuboid}
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

  def createDataRequest(dataSet: DataSet, dataLayer: DataLayer, dataSection: Option[String], width: Int, height: Int, depth: Int, parsed: ParsedRequest): DataRequest = {
    val settings = DataRequestSettings(
      useHalfByte = parsed.useHalfByte,
      skipInterpolation = false
    )
    createDataRequest(dataSet, dataLayer, dataSection, width, height, depth, parsed.position, parsed.resolutionExponent, settings)
  }

  def createDataRequest(dataSet: DataSet, dataLayer: DataLayer, dataSection: Option[String], cubeSize: Int, parsed: ParsedRequest): DataRequest = {
    createDataRequest(dataSet, dataLayer, dataSection, cubeSize, cubeSize, cubeSize, parsed)
  }

  def createDataRequest(dataSet: DataSet, dataLayer: DataLayer, dataSection: Option[String], width: Int, height: Int, depth: Int, position: Point3D, resolutionExponent: Int, settings: DataRequestSettings) = {
    val resolution = resolutionFromExponent(resolutionExponent)
    val cuboid = Cuboid(width, height, depth,  resolution, Some(Vector3D(position)))

    DataRequest(
      dataSet,
      dataLayer,
      dataSection,
      resolution,
      cuboid,
      settings)
  }
}
