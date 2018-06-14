/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.tools

object Math {
  val RotationMatrixSize3D = 16

  val EPSILON = 1e-10

  def square(x: Int) = x * x

  def square(d: Double) = d * d

  val lnOf2 = scala.math.log(2) // natural log of 2

  def log2(x: Double): Double = scala.math.log(x) / lnOf2

  def roundUp(x: Double) = {
    val c = x.ceil.toInt
    if(c != x)
      c + 1
    else
      c
  }

  def roundDown(x: Double) = {
    val c = x.floor.toInt
    if(c != x)
      c - 1
    else
      c
  }

  def clamp[T](x: T, lower: T, upper: T)(implicit num: Numeric[T]): T = {
    import num._
    lower.max(x).min(upper)
  }

}
