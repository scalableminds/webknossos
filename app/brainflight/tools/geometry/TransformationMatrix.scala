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
  
  def apply(pos: Vector3D, directionOld: Vector3D): TransformationMatrix = {
    val direction = Vector3D(directionOld.x * 11.28, directionOld.y * 11.28, directionOld.z * 28)
    val nz = direction.normalize
    val y = Vector3D(0, 1, 0)
    val nx = (nz x y).normalize
    val ny = (nz x nx).normalize

    TransformationMatrix(Array(nx.x, nx.y, nx.z, 0, ny.x, ny.y, ny.z, 0, nz.x, nz.y, nz.z, 0, pos.x, pos.y, pos.z, 1).map(_.toFloat))
  }
}