package brainflight.tools

import scala.math._

import util.DynamicVariable

/**
 * Scalable Minds - Brainflight
 * User: tom
 * Date: 10/11/11
 * Time: 8:53 AM
 */

object Math {
  def square(x:Int) = x * x
  def square(x:Double) = x * x
  def normalizeVector(v:Tuple3[Int,Int, Int]):Tuple3[Double, Double, Double] = {
    var l = sqrt(square(v._1) + square(v._2) + square(v._3))
    if(l>0) (v._1 / l,  v._2 / l, v._3 / l) else (v._1.toDouble,v._2.toDouble,v._3.toDouble)
  }
}