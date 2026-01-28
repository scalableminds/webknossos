package com.scalableminds.webknossos.datastore.datavault

import com.scalableminds.util.tools.Fox
import play.api.http.{HeaderNames, Status}
import play.api.mvc.{AnyContent, Request}

import scala.concurrent.ExecutionContext

trait ByteRange extends Status {
  def successResponseCode: Int = OK
}

case class StartEndExclusiveByteRange(start: Long, end: Long) extends ByteRange {
  def length: Int = (end - start).toInt
  def toHttpHeader: String = s"bytes=$start-${end - 1}" // HTTP header is inclusive
  override def successResponseCode: Int = PARTIAL_CONTENT
}
case class SuffixLengthByteRange(length: Int) extends ByteRange {
  def toHttpHeader: String = s"bytes=-$length" // HTTP header is inclusive
  override def successResponseCode: Int = PARTIAL_CONTENT
}
case class CompleteByteRange() extends ByteRange

object ByteRange extends HeaderNames {
  def startEndExclusive(start: Long, end: Long): StartEndExclusiveByteRange = StartEndExclusiveByteRange(start, end)

  def startEndInclusive(start: Long, end: Long): StartEndExclusiveByteRange = StartEndExclusiveByteRange(start, end + 1)

  def suffix(length: Int): SuffixLengthByteRange = SuffixLengthByteRange(length)

  def complete: CompleteByteRange = CompleteByteRange()

  private lazy val byteRangeRegex = """^bytes=(\d+)-(\d+)$""".r
  private lazy val suffixRangeRegex = """^bytes=-(\d+)$""".r

  def fromRequest(request: Request[AnyContent])(implicit ec: ExecutionContext): Fox[ByteRange] =
    request.headers.get(RANGE) match {
      case None => Fox.successful(ByteRange.complete)
      case Some(rangeHeader) =>
        rangeHeader match {
          case byteRangeRegex(start, end) => Fox.successful(ByteRange.startEndInclusive(start.toLong, end.toLong))
          case suffixRangeRegex(length)   => Fox.successful(ByteRange.suffix(length.toInt))
          case _ =>
            Fox.failure(
              s"Invalid range header “$rangeHeader”, only single start-end byte ranges and suffix-ranges are supported.")
        }
    }
}
