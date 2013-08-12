package brainflight.tools.geometry

case class TransformationMatrix(value: Array[Float]) {
  /**
   * Extract the translation from the transformation matrix
   */
  def extractTranslation: Option[Vector3D] =
    value match {
      case matrix if matrix.size >= TransformationMatrix.defaultSize =>
        Some(new Vector3D(matrix(12), matrix(13), matrix(14)))
      case _ =>
        None
    }
}

object TransformationMatrix {
  val defaultSize = 16

  def apply(pos: Vector3D, direction: Vector3D): TransformationMatrix = {
    
    val nz = direction.normalize
    val y = Vector3D(0, 1, 0)
    val nx = (nz x y).normalize
    val ny = (nz x nx).normalize

    TransformationMatrix(Array(
      nx.x, nx.y, nx.z, pos.x,
      ny.x, ny.y, ny.z, pos.y,
      nz.x * 11.24 / 28, nz.y * 11.24 / 28, nz.z * 11.24 / 28, pos.z,
      0, 0, 0, 1).map(_.toFloat))
  }
}