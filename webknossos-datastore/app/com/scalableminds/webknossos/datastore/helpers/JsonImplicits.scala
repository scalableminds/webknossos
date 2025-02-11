package com.scalableminds.webknossos.datastore.helpers

import com.scalableminds.util.tools.Box.tryo
import play.api.libs.json.{Format, JsNumber, JsResult, JsValue, Json}

trait JsonImplicits {

  implicit object NumberFormat extends Format[Number] {

    override def reads(json: JsValue): JsResult[Number] =
      json
        .validate[Long]
        .map(_.asInstanceOf[Number])
        .orElse(json.validate[Float].map(_.asInstanceOf[Number]))
        .orElse(json.validate[Double].map(_.asInstanceOf[Number]))

    override def writes(number: Number): JsValue =
      tryo(number.longValue())
        .map(JsNumber(_))
        .orElse(tryo(BigDecimal(number.doubleValue())).map(JsNumber(_)))
        .getOrElse(JsNumber(number.doubleValue()))
  }

  implicit object StringOrIntFormat extends Format[Either[String, Int]] {

    override def reads(json: JsValue): JsResult[Either[String, Int]] =
      json.validate[String].map(Left(_)).orElse(json.validate[Int].map(Right(_)))

    override def writes(stringOrInt: Either[String, Int]): JsValue =
      stringOrInt match {
        case Left(s)  => Json.toJson(s)
        case Right(n) => Json.toJson(n)
      }
  }

  implicit object StringOrNumberFormat extends Format[Either[String, Number]] {

    override def reads(json: JsValue): JsResult[Either[String, Number]] =
      json.validate[String].map(Left(_)).orElse(json.validate[Number].map(Right(_)))

    override def writes(stringOrNumber: Either[String, Number]): JsValue =
      stringOrNumber match {
        case Left(s)  => Json.toJson(s)
        case Right(n) => Json.toJson(n)
      }
  }
}
