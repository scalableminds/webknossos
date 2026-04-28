package com.scalableminds.webknossos.datastore.datareaders

import ArrayDataType.ArrayDataType
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.tools.{Box, Failure, Full}
import com.scalableminds.util.tools.Box.tryo
import ucar.ma2.{Index, IndexIterator, InvalidRangeException, Range, Array => MultiArray, DataType => MADataType}

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
      case ArrayDataType.bool                  => new Array[Boolean](length)
    }
  }

  def createArrayWithGivenStorage(storage: Any, shape: Array[Int]): MultiArray = {
    val aClass = storage.getClass
    if (!aClass.isArray) throw new Exception("Underlying storage for MultiArray must be array")
    MultiArray.factory(MADataType.getType(aClass.getComponentType, false), shape, storage)
  }

  def createFilledArray(dataType: MADataType,
                        shape: Array[Int],
                        fillNum: Number,
                        fillBool: Boolean): Box[MultiArray] = {
    val array = MultiArray.factory(dataType, shape)
    val iter = array.getIndexIterator
    tryo {
      if (fillNum != null) {
        if (MADataType.DOUBLE == dataType) while ({ iter.hasNext }) iter.setDoubleNext(fillNum.doubleValue)
        else if (MADataType.FLOAT == dataType) while ({ iter.hasNext }) iter.setFloatNext(fillNum.floatValue)
        else if (MADataType.LONG == dataType) while ({ iter.hasNext }) iter.setLongNext(fillNum.longValue)
        else if (MADataType.INT == dataType) while ({ iter.hasNext }) iter.setIntNext(fillNum.intValue)
        else if (MADataType.SHORT == dataType) while ({ iter.hasNext }) iter.setShortNext(fillNum.shortValue)
        else if (MADataType.BYTE == dataType) while ({ iter.hasNext }) iter.setByteNext(fillNum.byteValue)
        else if (MADataType.BOOLEAN == dataType) while ({ iter.hasNext }) iter.setBooleanNext(fillBool)
        else throw new IllegalStateException
      }
      array
    }
  }

  def createEmpty(dataType: ArrayDataType, rank: Int): MultiArray = {
    val datyTypeMA = dataType match {
      case ArrayDataType.i1 | ArrayDataType.u1 => MADataType.BYTE
      case ArrayDataType.i2 | ArrayDataType.u2 => MADataType.SHORT
      case ArrayDataType.i4 | ArrayDataType.u4 => MADataType.INT
      case ArrayDataType.i8 | ArrayDataType.u8 => MADataType.LONG
      case ArrayDataType.f4                    => MADataType.FLOAT
      case ArrayDataType.f8                    => MADataType.DOUBLE
    }
    MultiArray.factory(datyTypeMA, Array.fill(rank)(0))
  }

  def toLongArray(multiArray: MultiArray): Box[Array[Long]] =
    multiArray.getDataType match {
      case MADataType.LONG | MADataType.ULONG =>
        Full(multiArray.getStorage.asInstanceOf[Array[Long]])
      case MADataType.INT =>
        Full(multiArray.getStorage.asInstanceOf[Array[Int]].map(_.toLong))
      case MADataType.UINT =>
        Full(multiArray.getStorage.asInstanceOf[Array[Int]].map { signed =>
          if (signed >= 0) signed.toLong else signed.toLong + Int.MaxValue.toLong + Int.MaxValue.toLong + 2L
        })
      case _ =>
        Failure("Cannot convert MultiArray to LongArray: unsupported data type.")
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
    val rank = offset.length
    val sourceFirsts = new Array[Int](rank)
    val targetFirsts = new Array[Int](rank)
    val counts = new Array[Int](rank)
    for (d <- 0 until rank) {
      val dimOffset = offset(d)
      val sourceFirst = if (dimOffset >= 0) dimOffset else 0
      val targetFirst = if (dimOffset >= 0) 0 else -dimOffset
      val maxSteps = Math.min(sourceShape(d) - sourceFirst, targetShape(d) - targetFirst)
      if (maxSteps <= 0) return
      sourceFirsts(d) = sourceFirst
      targetFirsts(d) = targetFirst
      counts(d) = maxSteps
    }
    // Fast path: both arrays are C-order contiguous with the same element type.
    // Uses System.arraycopy per inner-dimension line instead of element-by-element iteration.
    // The slow path handles permuted views (e.g. the F-order path in readAsFortranOrder).
    if (source.getElementType == target.getElementType &&
        isCOrderContiguous(source) &&
        isCOrderContiguous(target)) {
      copyRangeBulk(sourceFirsts, targetFirsts, counts, sourceShape, targetShape,
                    source.getStorage, target.getStorage)
    } else {
      val sourceRanges = new util.ArrayList[Range](rank)
      val targetRanges = new util.ArrayList[Range](rank)
      for (d <- 0 until rank) {
        sourceRanges.add(new Range(sourceFirsts(d), sourceFirsts(d) + counts(d) - 1))
        targetRanges.add(new Range(targetFirsts(d), targetFirsts(d) + counts(d) - 1))
      }
      val sourceRangeIterator = source.getRangeIterator(sourceRanges)
      val targetRangeIterator = target.getRangeIterator(targetRanges)
      val setter = createValueSetter(source.getElementType)
      while (sourceRangeIterator.hasNext) setter.set(sourceRangeIterator, targetRangeIterator)
    }
  }

  // Checks C-order contiguous layout by probing the stride of one non-trivial dimension.
  // Sets a multi-dim counter with 1 at the rightmost dim with size > 1, then verifies that
  // the resulting flat index equals what C-order would predict: product(shape[checkDim+1:]).
  // Uses a cloned index to avoid mutating the array's internal index state.
  private def isCOrderContiguous(array: MultiArray): Boolean = {
    val shape = array.getShape
    val rank = shape.length
    if (rank <= 1) return true
    var checkDim = rank - 1
    while (checkDim >= 0 && shape(checkDim) <= 1) checkDim -= 1
    if (checkDim < 0) return true // all dims are size 1 — trivially any order
    var expectedStride = 1
    for (d <- checkDim + 1 until rank) expectedStride *= shape(d)
    val testCounter = new Array[Int](rank)
    testCounter(checkDim) = 1
    val probeIndex = array.getIndex.clone().asInstanceOf[Index]
    probeIndex.set(testCounter).currentElement() == expectedStride
  }

  // Copies a rectangular sub-region using System.arraycopy along the innermost dimension.
  // Requires both arrays to be C-order contiguous with the same element type.
  private def copyRangeBulk(sourceFirsts: Array[Int],
                             targetFirsts: Array[Int],
                             counts: Array[Int],
                             sourceShape: Array[Int],
                             targetShape: Array[Int],
                             srcStorage: Object,
                             tgtStorage: Object): Unit = {
    val rank = counts.length
    val lineLength = counts(rank - 1)

    val srcStrides = new Array[Int](rank)
    val tgtStrides = new Array[Int](rank)
    srcStrides(rank - 1) = 1
    tgtStrides(rank - 1) = 1
    for (d <- rank - 2 to 0 by -1) {
      srcStrides(d) = srcStrides(d + 1) * sourceShape(d + 1)
      tgtStrides(d) = tgtStrides(d + 1) * targetShape(d + 1)
    }

    var srcBase = 0
    var tgtBase = 0
    for (d <- 0 until rank) {
      srcBase += sourceFirsts(d) * srcStrides(d)
      tgtBase += targetFirsts(d) * tgtStrides(d)
    }

    var outerTotal = 1
    for (d <- 0 until rank - 1) outerTotal *= counts(d)

    val outerIdx = new Array[Int](rank - 1)
    var srcCurrent = srcBase
    var tgtCurrent = tgtBase
    var line = 0
    while (line < outerTotal) {
      System.arraycopy(srcStorage, srcCurrent, tgtStorage, tgtCurrent, lineLength)
      var d = rank - 2
      var carrying = true
      while (d >= 0 && carrying) {
        outerIdx(d) += 1
        srcCurrent += srcStrides(d)
        tgtCurrent += tgtStrides(d)
        if (outerIdx(d) < counts(d)) {
          carrying = false
        } else {
          srcCurrent -= counts(d) * srcStrides(d)
          tgtCurrent -= counts(d) * tgtStrides(d)
          outerIdx(d) = 0
          d -= 1
        }
      }
      line += 1
    }
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
