package braingames.binary

import braingames.binary.models._

trait AbstractDataRequest

trait DataRequest extends AbstractDataRequest {
  def dataSource: DataSource
  def dataLayer: DataLayer
  def dataSection: Option[String]
  def resolution: Int
  def cuboid: Cuboid
  }

case class DataReadRequest(
  dataSource: DataSource,
  dataLayer: DataLayer,
  dataSection: Option[String],
  resolution: Int,
  cuboid: Cuboid,
  settings: DataRequestSettings) extends DataRequest

case class DataRequestSettings(
  useHalfByte: Boolean /* = false*/,
  skipInterpolation: Boolean)

case class DataWriteRequest(
  dataSource: DataSource,
  dataLayer: DataLayer,
  dataSection: Option[String],
  resolution: Int,
  cuboid: Cuboid,
  data: Array[Byte]) extends DataRequest

case class DataRequestCollection(requests: Seq[DataRequest]) extends AbstractDataRequest

object DataRequestCollection {
  def apply(dataRequest: DataRequest): DataRequestCollection =
    DataRequestCollection(Array(dataRequest))
}
