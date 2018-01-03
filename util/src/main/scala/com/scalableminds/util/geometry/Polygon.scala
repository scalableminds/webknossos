/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.geometry

import play.api.libs.json.Json._
import play.api.libs.json._

import scala.math._

/**
 * Representation of a regular polygon in a 2 dimensional space
 * n - is the number of vertices and a is the apothem
 * http://en.wikipedia.org/wiki/Regular_polygon
 */
class RegularPolygon( numberOfVertices: Int, apothem: Int ) {
  val vertices = {
    // angle between two diagonals
    val alpha = 2 * Pi / numberOfVertices
    // vector to the first vertex
    var pointVector = new Vector2D( -tan( alpha / 2 ) * apothem, apothem )
    var vertices = pointVector :: Nil
    // length of the polygons sides
    val s = 2 * tan( alpha / 2 ) * apothem
    // vector which is used to generate the following vertices
    // through iteration, rotating and vector addition
    var v = new Vector2D( -s, 0 )
    for ( i <- 1 until numberOfVertices ) {
      v = v.rotate( alpha )
      pointVector = pointVector + v
      vertices = vertices ::: pointVector :: Nil
    }
    vertices
  }
  /**
   * Returns the vertex at the given index. Negative indices are used
   * to navigate clockwise
   */
  def vertex( index: Int ) = {
    val i = ( index % vertices.size )
    if ( i < 0 ) vertices( vertices.size + i ) else vertices( i )
  }
  // convert polygon to a valid json representation
  def to3D( value: Int, position: Int ) =
    vertices.map( v => v.to3D( value, position ) )
}

/**
 * Simple polygon implementation
 */
class Polygon( val vertices: List[Vector3D] ) {
  val normalVector = {
    if ( vertices.size < 3 )
      throw new IllegalStateException( "Not a valid Polygon: " + vertices )
    else
      ( vertices( 0 ) - vertices( 1 ) ) x ( vertices( 2 ) - vertices( 1 ) )
  }

  def transformAffine( matrix: Array[Float] ): Polygon = {
    new Polygon( vertices.map( _.transformAffine( matrix ) ) )
  }

  val d = normalVector ° vertices( 0 )

  override def toString = {
    vertices.toString
  }
}
object Polygon {
  // json converter
  implicit object PolygonWrites extends Writes[Polygon] {
    def writes( p: Polygon ) = JsArray( p.vertices.map( v => toJson( v.toVector3I ) ) )
  }
}
