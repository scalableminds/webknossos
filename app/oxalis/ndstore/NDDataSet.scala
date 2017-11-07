/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package oxalis.ndstore

import play.api.libs.functional.syntax._
import play.api.libs.json.{Reads, _}

case class NDDataSet(
  name: String,
  imageSize: Map[String, Array[Int]],
  resolutions: List[Int],
  offset: Map[String, Array[Int]],
  voxelRes: Map[String, Array[Float]]){
}

object NDDataSet{
  implicit val nddatasetReads = ((__ \ 'name).read[String] and
    (__ \ 'imagesize).read[Map[String, Array[Int]]] and
    (__ \ 'resolutions).read(Reads.minLength[List[Int]](1)) and
    (__ \ 'offset).read[Map[String, Array[Int]]] and
    (__ \ 'voxelres).read[Map[String, Array[Float]]])(NDDataSet.apply _)
}

