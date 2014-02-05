package braingames.binary.api

import braingames.geometry.{Vector3D, Point3D}
import braingames.binary.{DataRequestSettings, ParsedRequest, DataRequest, Cuboid}
import braingames.binary.models.{DataLayerId, DataSource}

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 04.08.13
 * Time: 20:04
 */
trait BinaryDataHelpers {

  def resolutionFromExponent(resolutionExponent: Int) =
    math.pow(2, resolutionExponent).toInt

  def createDataRequest(dataSource: DataSource, dataLayerId: DataLayerId, width: Int, height: Int, depth: Int, parsed: ParsedRequest): DataRequest = {
    val settings = DataRequestSettings(
      useHalfByte = parsed.useHalfByte,
      skipInterpolation = false
    )
    createDataRequest(dataSource, dataLayerId, width, height, depth, parsed.position, parsed.resolutionExponent, settings)
  }

  def createDataRequest(dataSource: DataSource, dataLayerId: DataLayerId, cubeSize: Int, parsed: ParsedRequest): DataRequest = {
    createDataRequest(dataSource, dataLayerId, cubeSize, cubeSize, cubeSize, parsed)
  }

  def createDataRequest(dataSource: DataSource, dataLayerId: DataLayerId, width: Int, height: Int, depth: Int, position: Point3D, resolutionExponent: Int, settings: DataRequestSettings) = {
    val resolution = resolutionFromExponent(resolutionExponent)
    val cuboid = Cuboid(width, height, depth,  resolution, Some(Vector3D(position)))

    DataRequest(
      dataSource,
      dataLayerId,
      resolution,
      cuboid,
      settings)
  }
}
