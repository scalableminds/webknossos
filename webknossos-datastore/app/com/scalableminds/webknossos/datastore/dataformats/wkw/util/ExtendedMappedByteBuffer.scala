package com.scalableminds.webknossos.datastore.dataformats.wkw.util

import java.nio.MappedByteBuffer

import net.liftweb.common.{Box, Failure, Full}
import net.liftweb.common.Box.tryo

class ExtendedMappedByteBuffer(mappedData: MappedByteBuffer) {

  def capacity: Int = mappedData.capacity

  def copyTo(offset: java.lang.Integer,
             other: Array[Byte],
             destPos: java.lang.Integer,
             length: java.lang.Integer): Box[Unit] =
    // Any regularly called log statements in here should be avoided as they drastically slow down this method.
    if (offset + length <= mappedData.limit()) {
      tryo {
        for (i <- 0 until length) {
          other(destPos + i) = mappedData.get(offset + i)
        }
        Full(())
      }
    } else {
      Failure("Could not copy from memory mapped array.")
    }

  def copyFrom(offset: java.lang.Integer,
               other: Array[Byte],
               srcPos: java.lang.Integer,
               length: java.lang.Integer): Box[Unit] =
    // Any regularly called log statements in here should be avoided as they drastically slow down this method.
    if (offset + length <= mappedData.limit()) {
      tryo {
        for (i <- 0 until length) {
          mappedData.put(offset + i, other(srcPos + i))
        }
        Full(())
      }
    } else {
      Failure("Could not copy to memory mapped array.")
    }
}
