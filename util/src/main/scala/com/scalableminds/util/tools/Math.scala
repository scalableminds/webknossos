package com.scalableminds.util.tools

import java.nio.{ByteBuffer, ByteOrder}

import Numeric.Implicits._

object Math {
  val RotationMatrixSize3D = 16

  val EPSILON = 1e-10

  def square(x: Int): Int = x * x

  def square(d: Double): Double = d * d

  val lnOf2: Double = scala.math.log(2) // natural log of 2

  def log2(x: Double): Double = scala.math.log(x) / lnOf2

  def clamp[T](x: T, lower: T, upper: T)(implicit num: Numeric[T]): T = {
    import num._
    lower.max(x).min(upper)
  }

  def mean[T: Numeric](xs: Iterable[T]): Double = xs.sum.toDouble / xs.size

  def variance[T: Numeric](xs: Iterable[T]): Double = {
    val avg = mean(xs)

    xs.map(_.toDouble).map(a => math.pow(a - avg, 2)).sum / xs.size
  }

  def stdDev[T: Numeric](xs: Iterable[T]): Double = math.sqrt(variance(xs))

}
