package com.scalableminds.webknossos.datastore.datareaders.precomputed

import com.scalableminds.util.enumeration.ExtendedEnumeration
import com.scalableminds.webknossos.datastore.datareaders.ArrayDataType
import com.scalableminds.webknossos.datastore.datareaders.ArrayDataType.ArrayDataType

object PrecomputedDataType extends ExtendedEnumeration {
  type PrecomputedDataType = Value
  val uint8, uint16, uint32, uint64, float32 = Value

  /*
  https://github.com/google/neuroglancer/blob/master/src/neuroglancer/datasource/precomputed/volume.md#info-json-file-specification

  "data_type": A string value equal (case-insensitively) to the name of one of the supported DataType values specified in data_type.ts.
  May be one of "uint8", "uint16", "uint32", "uint64", or "float32". "float32" should only be specified for "image" volumes.

   */

  def toArrayDataType(dataType: PrecomputedDataType): ArrayDataType =
    dataType match {
      case `float32` => ArrayDataType.f4
      case `uint64`  => ArrayDataType.u8
      case `uint32`  => ArrayDataType.u4
      case `uint16`  => ArrayDataType.u2
      case `uint8`   => ArrayDataType.u1
    }
}
