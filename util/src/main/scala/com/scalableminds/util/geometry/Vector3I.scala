/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.geometry

import play.api.data.validation.ValidationError
import play.api.libs.json.Json._
import play.api.libs.json._

import scala.math._

case class Vector3I( val x: Int, val y: Int, val z: Int){

  def -( o: Vector3I) = Vector3I( x - o.x, y - o.y, z - o.z )
  def +( o: Vector3I) = Vector3I( x + o.x, y + o.y, z + o.z )

  def fillGapTill( dest: Vector3I ): List[Vector3I] = {
    val dx = x - dest.x
    val dy = y - dest.y
    val dz = z - dest.z

    val maxSize = max( dx.abs, max( dy.abs, dz.abs ) )

    val xList = List.fill( dx.abs )( dx.signum ) ::: List.fill( maxSize - dx.abs )( 0 )
    val yList = List.fill( dy.abs )( dy.signum ) ::: List.fill( maxSize - dy.abs )( 0 )
    val zList = List.fill( dz.abs )( dz.signum ) ::: List.fill( maxSize - dz.abs )( 0 )

    List( xList, yList, zList ).transpose.map( Vector3I.IntListToVector3I )
  }
}

object Vector3I{

  val defaultSize = 3

  implicit def Vector3IToIntTuple( v: Vector3I ) = ( v.x, v.y, v.z )
  implicit def Vector3IToIntList( v: Vector3I ) = List( v.x, v.y, v.z )
  implicit def Vector3IToIntArray( v: Vector3I ) = Array( v.x, v.y, v.z )
  implicit def IntListToVector3I( l: List[Int] ) = Vector3I( l(0), l(1), l(2) )
  implicit def IntListToVector3I( l: Array[Int] ) = Vector3I( l(0), l(1), l(2) )

  // json converter
  implicit object Vector3IWrites extends Writes[Vector3I] {
    def writes( v: Vector3I ) = {
      val l = List( v.x, v.y, v.z )
      JsArray( l.map( toJson( _ ) ) )
    }
  }
  implicit object Vector3IReads extends Reads[Vector3I] {
    def reads( json: JsValue ) = json match {
      case JsArray( ts ) if ts.size == 3 =>
        val c = ts.map( fromJson[Int]( _ ) ).flatMap( _.asOpt)
        if(c.size != 3)
          JsError(Seq(JsPath() -> Seq(ValidationError("validate.error.array.invalidContent"))))
        else
          JsSuccess(Vector3I(c(0), c(1), c(2)))
      case _ =>
        JsError(Seq(JsPath() -> Seq(ValidationError("validate.error.expected.point3DArray"))))
    }
  }
}
