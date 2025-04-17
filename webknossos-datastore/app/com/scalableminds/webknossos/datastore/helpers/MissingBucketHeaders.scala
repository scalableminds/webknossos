package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import net.liftweb.common.Box.tryo

import scala.concurrent.ExecutionContext

trait MissingBucketHeaders extends FoxImplicits {

  protected lazy val missingBucketsHeader: String = "MISSING-BUCKETS"

  protected def createMissingBucketsHeaders(indices: List[Int]): Seq[(String, String)] =
    List(missingBucketsHeader -> formatMissingBucketList(indices),
         "Access-Control-Expose-Headers" -> missingBucketsHeader)

  private def formatMissingBucketList(indices: List[Int]): String =
    "[" + indices.mkString(", ") + "]"

  protected def parseMissingBucketHeader(headerLiteralOpt: Option[String])(
      implicit ec: ExecutionContext): Fox[List[Int]] =
    for {
      headerLiteral: String <- headerLiteralOpt.toFox
      headerLiteralTrim = headerLiteral.trim
      _ <- Fox.fromBool(headerLiteralTrim.startsWith("[") && headerLiteralTrim.endsWith("]"))
      indicesStr = headerLiteralTrim.drop(1).dropRight(1).split(",").toList.filter(_.nonEmpty)
      indices <- Fox.serialCombined(indicesStr)(indexStr => tryo(indexStr.trim.toInt).toFox)
    } yield indices

}
