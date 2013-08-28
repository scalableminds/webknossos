package braingames.binary

import braingames.binary.models._

trait AbstractDataRequest

case class DataRequest(
  dataSet: DataSet,
  dataLayer: DataLayerId,
  resolution: Int,
  cuboid: Cuboid,
  settings: DataRequestSettings) extends AbstractDataRequest

case class DataRequestSettings(
  useHalfByte: Boolean /* = false*/,
  skipInterpolation: Boolean)

case class DataRequestCollection(requests: Seq[DataRequest]) extends AbstractDataRequest

object DataRequestCollection {
  def apply(dataRequest: DataRequest): DataRequestCollection =
    DataRequestCollection(Array(dataRequest))
}