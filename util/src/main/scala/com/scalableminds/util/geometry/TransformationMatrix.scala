package com.scalableminds.util.geometry

case class MatrixBase3D(x: Vector3D, y: Vector3D, z: Vector3D)

case class TransformationMatrix(value: Array[Float]) {
  val width = math.sqrt(TransformationMatrix.defaultSize).toInt
  val height = width
}

object TransformationMatrix {
  val defaultSize = 16

  def identity =
    TransformationMatrix(Array[Float](1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1))

  def apply(pos: Vector3D, rotationBase: MatrixBase3D): TransformationMatrix = {

    val MatrixBase3D(ny, nx, nz) = rotationBase

    TransformationMatrix(
      Array(
        nx.x,
        ny.x,
        nz.x,
        pos.x,
        nx.y,
        ny.y,
        nz.y,
        pos.y,
        nx.z * 11.24 / 28,
        ny.z * 11.24 / 28,
        nz.z * 11.24 / 28,
        pos.z,
        0,
        0,
        0,
        1
      ).map(_.toFloat))
  }
}
