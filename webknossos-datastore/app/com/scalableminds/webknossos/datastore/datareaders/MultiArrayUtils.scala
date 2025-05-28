package com.scalableminds.webknossos.datastore.datareaders

import ArrayDataType.ArrayDataType
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box
import net.liftweb.common.Box.tryo
import ucar.ma2.{IndexIterator, InvalidRangeException, Range, Array => MultiArray, DataType => MADataType}

import java.util

object MultiArrayUtils extends LazyLogging {

  def createDataBuffer(dataType: ArrayDataType, shape: Array[Int]): Object = {
    val length = shape.product
    dataType match {
      case ArrayDataType.i1 | ArrayDataType.u1 => new Array[Byte](length)
      case ArrayDataType.i2 | ArrayDataType.u2 => new Array[Short](length)
      case ArrayDataType.i4 | ArrayDataType.u4 => new Array[Int](length)
      case ArrayDataType.i8 | ArrayDataType.u8 => new Array[Long](length)
      case ArrayDataType.f4                    => new Array[Float](length)
      case ArrayDataType.f8                    => new Array[Double](length)
    }
  }

  def createArrayWithGivenStorage(storage: Any, shape: Array[Int]): MultiArray = {
    val aClass = storage.getClass
    if (!aClass.isArray) throw new Exception("Underlying storage for MultiArray must be array")
    MultiArray.factory(MADataType.getType(aClass.getComponentType, false), shape, storage)
  }

  def createFilledArray(dataType: MADataType, shape: Array[Int], fill: Number): Box[MultiArray] = {
    val array = MultiArray.factory(dataType, shape)
    val iter = array.getIndexIterator
    tryo {
      if (fill != null) {
        if (MADataType.DOUBLE == dataType) while ({ iter.hasNext }) iter.setDoubleNext(fill.doubleValue)
        else if (MADataType.FLOAT == dataType) while ({ iter.hasNext }) iter.setFloatNext(fill.floatValue)
        else if (MADataType.LONG == dataType) while ({ iter.hasNext }) iter.setLongNext(fill.longValue)
        else if (MADataType.INT == dataType) while ({ iter.hasNext }) iter.setIntNext(fill.intValue)
        else if (MADataType.SHORT == dataType) while ({ iter.hasNext }) iter.setShortNext(fill.shortValue)
        else if (MADataType.BYTE == dataType) while ({ iter.hasNext }) iter.setByteNext(fill.byteValue)
        else throw new IllegalStateException
      }
      array
    }
  }

  def createEmpty(rank: Int): MultiArray =
    MultiArray.factory(MADataType.FLOAT, Array.fill(rank)(0))

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

  private def createValueSetter(elementType: Class[_]): MultiArrayUtils.ValueSetter =
    if (elementType eq classOf[Double])(sourceIterator: IndexIterator, targetIterator: IndexIterator) =>
      targetIterator.setDoubleNext(sourceIterator.getDoubleNext)
    else if (elementType eq classOf[Float])(sourceIterator: IndexIterator, targetIterator: IndexIterator) =>
      targetIterator.setFloatNext(sourceIterator.getFloatNext)
    else if (elementType eq classOf[Long])(sourceIterator: IndexIterator, targetIterator: IndexIterator) =>
      targetIterator.setLongNext(sourceIterator.getLongNext)
    else if (elementType eq classOf[Int])(sourceIterator: IndexIterator, targetIterator: IndexIterator) =>
      targetIterator.setIntNext(sourceIterator.getIntNext)
    else if (elementType eq classOf[Short])(sourceIterator: IndexIterator, targetIterator: IndexIterator) =>
      targetIterator.setShortNext(sourceIterator.getShortNext)
    else if (elementType eq classOf[Byte])(sourceIterator: IndexIterator, targetIterator: IndexIterator) =>
      targetIterator.setByteNext(sourceIterator.getByteNext)
    else
      (sourceIterator: IndexIterator, targetIterator: IndexIterator) =>
        targetIterator.setObjectNext(sourceIterator.getObjectNext)

  private trait ValueSetter {
    def set(sourceIterator: IndexIterator, targetIterator: IndexIterator): Unit
  }

  def axisOrderXYZViewF(source: MultiArray, fullAxisOrder: FullAxisOrder, sourceIsF: Boolean): MultiArray = {
    // create view with F order and wk-compatible axis order
    val permutation = if (sourceIsF) fullAxisOrder.arrayFToWkFPermutation else fullAxisOrder.arrayCToWkFPermutation
    source.permute(permutation)
  }

}
