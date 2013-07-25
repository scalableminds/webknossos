package braingames.binary

trait CubeRequest

case class SingleCubeRequest(dataRequest: DataRequest)
  extends CubeRequest

case class MultiCubeRequest(requests: Seq[SingleCubeRequest])
  extends CubeRequest

object MultiCubeRequest {
  def apply(dataRequest: DataRequest): MultiCubeRequest =
    MultiCubeRequest(Array(SingleCubeRequest(dataRequest)))
}
