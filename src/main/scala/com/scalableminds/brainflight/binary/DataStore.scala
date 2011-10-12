package com.scalableminds.brainflight.binary

import collection.mutable.HashMap
import java.io.{InputStream, FileInputStream,File}

/**
 * Scalable Minds - Brainflight
 * User: tom
 * Date: 10/11/11
 * Time: 12:20 PM
 */

/**
 * A store which handles all binary data, the current implementation uses the given file structure on hdd
 */
object DataStore {
  // try to prevent loading a file multiple times into memory
  val fileBuffer = new HashMap[Tuple3[Int,Int,Int],Array[Byte]]

  /**
   * Load the binary data of the given coordinate from file
   */
  def load(point:Tuple3[Int, Int, Int]):Byte={
    // TODO: Insert upper bound
    if(point._1<0 || point._2<0 || point._3<0) return 0

    val x = point._1 / 128
    val y = point._2 / 128
    val z = point._3 / 128

    val byteArray:Array[Byte] = fileBuffer.get((x,y,z)) match {
      case Some(x) =>
        x
      case _ =>
        val br = new FileInputStream("binarydata/x%04d/y%04d/z%04d/100527_k0563_mag1_x%04d_y%04d_z%04d.raw".format(x,y,z,x,y,z))
        val start = System.currentTimeMillis()
        val b = inputStreamToByteArray(br)
        println("%d".format(System.currentTimeMillis()-start))
        fileBuffer += (((x, y, z), b))
        b
    }
    byteArray(((point._1%128)*128*128)+(point._2%128)* 128 + point._3 % 128)
  }

  /**
   *  Read file contents to a byteArray
    */
  def inputStreamToByteArray(is: InputStream) = {
    val b = new Array[Byte](2097152)
    is.read(b,0,2097152)
    b
  }
}