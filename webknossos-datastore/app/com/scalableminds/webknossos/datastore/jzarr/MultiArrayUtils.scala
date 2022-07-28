package com.scalableminds.webknossos.datastore.jzarr

import java.util

import com.scalableminds.webknossos.datastore.jzarr.ZarrDataType.ZarrDataType
import ucar.ma2.{IndexIterator, InvalidRangeException, Range, Array => MultiArray, DataType => MADataType}

object MultiArrayUtils {

  def createDataBuffer(dataType: ZarrDataType, shape: Array[Int]): Object = {
    val size = shape.product
    dataType match {
      case ZarrDataType.i1 | ZarrDataType.u1 => new Array[Byte](size)
      case ZarrDataType.i2 | ZarrDataType.u2 => new Array[Short](size)
      case ZarrDataType.i4 | ZarrDataType.u4 => new Array[Int](size)
      case ZarrDataType.i8 | ZarrDataType.u8 => new Array[Long](size)
      case ZarrDataType.f4                   => new Array[Float](size)
      case ZarrDataType.f8                   => new Array[Double](size)
    }
  }

  def createArrayWithGivenStorage(storage: Any, shape: Array[Int]): MultiArray = {
    val aClass = storage.getClass
    if (!aClass.isArray) throw new Exception("Underlying storage for MultiArray must be array")
    MultiArray.factory(MADataType.getType(aClass.getComponentType, false), shape, storage)
  }

  def createFilledArray(dataType: MADataType, shape: Array[Int], fill: Number): MultiArray = {
    val array = MultiArray.factory(dataType, shape)
    val iter = array.getIndexIterator
    if (fill != null)
      if (MADataType.DOUBLE == dataType) while ({ iter.hasNext }) iter.setDoubleNext(fill.doubleValue)
      else if (MADataType.FLOAT == dataType) while ({ iter.hasNext }) iter.setFloatNext(fill.floatValue)
      else if (MADataType.LONG == dataType) while ({ iter.hasNext }) iter.setLongNext(fill.longValue)
      else if (MADataType.INT == dataType) while ({ iter.hasNext }) iter.setIntNext(fill.intValue)
      else if (MADataType.SHORT == dataType) while ({ iter.hasNext }) iter.setShortNext(fill.shortValue)
      else if (MADataType.BYTE == dataType) while ({ iter.hasNext }) iter.setByteNext(fill.byteValue)
      else throw new IllegalStateException
    array
  }

  /**
    * Offset describes the displacement between source and target array.<br/>
    * <br/>
    * For example in the case of one dimensional arrays:<br/>
    * <pre>
    *     source array initialized { 1, 2, 3, 4, 5, 6, 7, 8, 9 }
    *     target array initialized { -1, -1, -1 }
    * </pre><br/>
    * An offset of 3 means that the target arrays will be displayed that way:<br/>
    * <pre>
    *     source   { 1, 2, 3, 4, 5, 6, 7, 8, 9 }
    *     target            { 4, 5, 6 }
    * </pre>
    * An offset of -2 means that the target arrays will be displayed that way:<br/>
    * <pre>
    *     source           { 1, 2, 3, 4, 5, 6, 7, 8, 9 }
    *     target   { -1, -1, 1 }
    * </pre>
    *
    * @param offset - the displacement between source and target
    * @param source - the source array
    * @param target - the target array
    */
  @throws[InvalidRangeException]
  def copyRange(offset: Array[Int], source: MultiArray, target: MultiArray): Unit = {
    val sourceShape: Array[Int] = source.getShape
    val targetShape: Array[Int] = target.getShape
    val sourceRanges = new util.ArrayList[Range]
    val targetRanges = new util.ArrayList[Range]
    println(
      s"copyRange, offset ${offset.toList}, sourceShape: ${sourceShape.toList}, targetShape: ${targetShape.toList}")
    for (dimension <- offset.indices) {
      val dimOffset = offset(dimension)
      var sourceFirst = 0
      var targetFirst = 0
      if (dimOffset >= 0) {
        sourceFirst = dimOffset
        targetFirst = 0
      } else {
        sourceFirst = 0
        targetFirst = dimOffset * -1
      }
      val maxSSteps = sourceShape(dimension) - sourceFirst
      val maxTSteps = targetShape(dimension) - targetFirst
      val maxSteps = Math.min(maxSSteps, maxTSteps)
      val sourceLast = sourceFirst + maxSteps
      val targetLast = targetFirst + maxSteps
      sourceRanges.add(new Range(sourceFirst, sourceLast - 1))
      targetRanges.add(new Range(targetFirst, targetLast - 1))
    }
    val sourceRangeIterator = source.getRangeIterator(sourceRanges)
    val targetRangeIterator = target.getRangeIterator(targetRanges)
    val elementType = source.getElementType
    val setter = createValueSetter(elementType)
    while ({ sourceRangeIterator.hasNext }) setter.set(sourceRangeIterator, targetRangeIterator)
  }

  private def createValueSetter(elementType: Class[_]): MultiArrayUtils.ValueSetter = {
    if (elementType eq classOf[Double])
      return (sourceIterator: IndexIterator, targetIterator: IndexIterator) =>
        targetIterator.setDoubleNext(sourceIterator.getDoubleNext)
    else if (elementType eq classOf[Float])
      return (sourceIterator: IndexIterator, targetIterator: IndexIterator) =>
        targetIterator.setFloatNext(sourceIterator.getFloatNext)
    else if (elementType eq classOf[Long])
      return (sourceIterator: IndexIterator, targetIterator: IndexIterator) =>
        targetIterator.setLongNext(sourceIterator.getLongNext)
    else if (elementType eq classOf[Int])
      return (sourceIterator: IndexIterator, targetIterator: IndexIterator) =>
        targetIterator.setIntNext(sourceIterator.getIntNext)
    else if (elementType eq classOf[Short])
      return (sourceIterator: IndexIterator, targetIterator: IndexIterator) =>
        targetIterator.setShortNext(sourceIterator.getShortNext)
    else if (elementType eq classOf[Byte])
      return (sourceIterator: IndexIterator, targetIterator: IndexIterator) =>
        targetIterator.setByteNext(sourceIterator.getByteNext)
    (sourceIterator: IndexIterator, targetIterator: IndexIterator) =>
      targetIterator.setObjectNext(sourceIterator.getObjectNext)
  }

  private trait ValueSetter {
    def set(sourceIterator: IndexIterator, targetIterator: IndexIterator)
  }

  def orderFlippedView(source: MultiArray): MultiArray = {
    val permutation = source.getShape.indices.reverse.toArray
    source.permute(permutation)
  }

  def axisOrderXYZView(source: MultiArray, axisOrder: AxisOrder, flip: Boolean): MultiArray = {
    // create a view in which the last three axes are XYZ, rest unchanged
    // optionally flip the axes afterwards
    val permutation = axisOrder.permutation(source.getRank) // TODO double check when to use inverse
    val flippedIfNeeded = if (flip) permutation.reverse else permutation
    // println(s"permutation (flipped=$flip): $flippedIfNeeded")
    source.permute(flippedIfNeeded)
  }

}
