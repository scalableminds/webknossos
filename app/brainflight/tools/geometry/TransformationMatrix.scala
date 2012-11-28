package brainflight.tools.geometry

case class TransformationMatrix(value: List[Float]) {
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

  def fromOrientedPosition(pos: OrientedPosition): TransformationMatrix = {

    val nz = pos.direction.normalize
    val x = Vector3D(1, 0, 0)
    val nx = (x - nz * (nz ° x)).normalize
    val y = Vector3D(0, 1, 0)
    val ny = (y - nz * (nz ° y) - nx * (nx ° y)).normalize

    TransformationMatrix(List(nx.x, nx.y, nx.z, 0, ny.x, ny.y, ny.z, 0, nz.x, nz.y, nz.z, 0, pos.translation.x, pos.translation.y, pos.translation.z, 1).map(_.toFloat))
  }
}