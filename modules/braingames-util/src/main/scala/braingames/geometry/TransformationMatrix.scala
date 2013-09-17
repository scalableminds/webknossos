package braingames.geometry

case class TransformationMatrix(value: Array[Float]) {
  val width = math.sqrt(TransformationMatrix.defaultSize).toInt
  val height = width

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

  def identity =
    TransformationMatrix(Array[Float](
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1))

  private def orthonormalBasis(direction: Vector3D):Tuple3[Vector3D, Vector3D, Vector3D] = {
    val nz = direction.normalize
    
    if(nz == Vector3D(0, 1, 0))
      (Vector3D(0,-1,0), Vector3D(0,0,1), Vector3D(1,0,0))
    else if ( nz == Vector3D(0, -1, 0))
      (Vector3D(0,-1,0), Vector3D(0,0,-1), Vector3D(1,0,0))
    else {
      val y = Vector3D(0, 1, 0)
      val nx = (nz x y).normalize
      val ny = (nz x nx).normalize
    
      (nx, ny, nz)
    }
  }
  
  def apply(pos: Vector3D, direction: Vector3D): TransformationMatrix = {
    
    val (nx, ny, nz) = orthonormalBasis(direction)

    TransformationMatrix(Array(
      nx.x, nx.y, nx.z, pos.x,
      ny.x, ny.y, ny.z, pos.y,
      nz.x * 11.24 / 28, nz.y * 11.24 / 28, nz.z * 11.24 / 28, pos.z,
      0, 0, 0, 1).map(_.toFloat))
  }
}