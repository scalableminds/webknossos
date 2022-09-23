package com.scalableminds.util.geometry;

case class Vec3Float(x: Float, y: Float, z: Float) {
  def scale(s: Float): Vec3Float = Vec3Float(x * s, y * s, z * s)

  def *(s: Float): Vec3Float = scale(s)
  def *(that: Vec3Float): Vec3Float = Vec3Float(x * that.x, y * that.y, z * that.z)
  def +(that: Vec3Float): Vec3Float = Vec3Float(x + that.x, y + that.y, z + that.y)
}
