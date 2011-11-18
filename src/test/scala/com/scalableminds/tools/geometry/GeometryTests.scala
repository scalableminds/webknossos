package com.scalableminds.tools.geometry

import org.specs2.mutable.Specification
import util.Random

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 18.11.11
 * Time: 22:27
 */

class GeometryTests extends Specification {
  "n-gonal Frustum" should {
    "contain n+2 polygons" in {
      // create frustum with atleast 3 vertices
      val n = new Random().nextInt(100) + 3
      new NGonalFrustum(n, 30,50,50).polygons.size must_== n+2
    }
    "be aple to convert to json String" in{
      new NGonalFrustum(3, 1, 5, 5).toString must_==
        "[[[-9,0,5],[0,0,-10],[9,0,5]],[[9,0,5],[0,0,-10],[0,1,-10],[9,1,5]]," +
        "[[0,0,-10],[-9,0,5],[-9,1,5],[0,1,-10]],[[-9,0,5],[9,0,5],[9,1,5]," +
        "[-9,1,5]],[[9,1,5],[0,1,-10],[-9,1,5]]]"
    }
    "create correct Frustrum" in {
      val p = new NGonalFrustum(3, 5, 5, 10).polygons
      p(0).toString must_== "[[-9,0,5],[0,0,-10],[9,0,5]]"
      p(3).toString must_== "[[-9,0,5],[9,0,5],[17,5,10],[-17,5,10]]"
      p(4).toString must_== "[[17,5,10],[0,5,-20],[-17,5,10]]"
    }
  }
  "A regulare n-polygon" should {
    "contain no identical vertices" in {
      val v = new RegularPolygon(10,20).vertices
      v.size must_== v.distinct.size
    }
    "contain n vertices" in {
      new RegularPolygon(10,20).vertices.size must_== 10
    }
    "traverse vertices counter clockwise" in{
      val v = new RegularPolygon(4,3)

      v.vertices(0).toString must_== "[-3,3]"
      v.vertices(1).toString must_== "[-3,-3]"
      v.vertices(2).toString must_== "[3,-3]"
      v.vertices(3).toString must_== "[3,3]"
    }
    "index vertices clockwise and counterclockwise" in {
      val p = new RegularPolygon(8,10)
      p.vertex(3) must_== p.vertex(-5)
      p.vertex(0) must_== p.vertex(-8)
    }
  }
  "A 2D-vector" should {
    "construct a 3D vector" in {
      val v = new Vector2D(5,8)
      v.x must_== 5
      v.y must_== 8
    }
    "be able to rotate" in {
      val v = new Vector2D(5,8) rotate 0.9
      v.x must_== -3.1585654356665454
      v.y must_== 8.889514294302732
    }
    "execute vector addition" in {
      val v = new Vector2D(5,8) + new Vector2D(6,-2)
      v.x must_== 11
      v.y must_== 6
    }
  }
}
