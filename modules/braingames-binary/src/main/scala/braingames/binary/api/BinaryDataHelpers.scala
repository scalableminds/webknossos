package braingames.binary.api

import braingames.geometry.{Vector3D, Point3D}
import braingames.binary.{DataRequestSettings, ParsedRequest, DataRequest, Cuboid}
import braingames.binary.models.{DataLayerId, DataSet}

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 04.08.13
 * Time: 20:04
 */
trait BinaryDataHelpers {

  val scaleFactors = Array(1, 1, 1)

  def resolutionFromExponent(resolutionExponent: Int) =
    math.pow(2, resolutionExponent).toInt

  def scaledCuboid(position: Point3D, width: Int, height: Int, depth: Int, resolution: Int) = {
    val scaledWidth = width / scaleFactors(0)
    val scaledHeight = height / scaleFactors(1)
    val scaledDepth = depth / scaleFactors(2)

    val cubeCorner = Vector3D(
      position.x - position.x % scaledWidth,
      position.y - position.y % scaledHeight,
      position.z - position.z % scaledDepth)

    Cuboid(scaledWidth, scaledHeight, scaledDepth, resolution, Some(cubeCorner))
  }

  def createDataRequest(dataSet: DataSet, dataLayerId: DataLayerId, width: Int, height: Int, depth: Int, parsed: ParsedRequest): DataRequest = {
    val settings = DataRequestSettings(
      useHalfByte = parsed.useHalfByte,
      skipInterpolation = false
    )
    createDataRequest(dataSet, dataLayerId, width, height, depth, parsed.position, parsed.resolutionExponent, settings)
  }

  def createDataRequest(dataSet: DataSet, dataLayerId: DataLayerId, cubeSize: Int, parsed: ParsedRequest): DataRequest = {
    createDataRequest(dataSet, dataLayerId, cubeSize, cubeSize, cubeSize, parsed)
  }

  def createDataRequest(dataSet: DataSet, dataLayerId: DataLayerId, width: Int, height: Int, depth: Int, position: Point3D, resolutionExponent: Int, settings: DataRequestSettings) = {
    val resolution = resolutionFromExponent(resolutionExponent)
    val cuboid = scaledCuboid(position, width, height, depth, resolution)

    DataRequest(
      dataSet,
      dataLayerId,
      resolution,
      cuboid,
      settings)
  }
}
