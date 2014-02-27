package models.user.time

import play.api.libs.json.Json

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 28.10.13
 * Time: 00:58
 */
case class PaymentInterval(month: Int, year: Int) extends Ordered[PaymentInterval] {

  def compare(p: PaymentInterval) : Int = +1 * (12 * (year - p.year) + (month - p.month))

  override def <(that: PaymentInterval): Boolean = (this compare that) < 0

  override def >(that: PaymentInterval): Boolean = (this compare that) > 0

  override def <=(that: PaymentInterval): Boolean = (this compare that) <= 0

  override def >=(that: PaymentInterval): Boolean = (this compare that) >= 0

  override def toString = "%d/%d".format(month, year)
}

object PaymentInterval {
	implicit val paymentIntervalFormat = Json.format[PaymentInterval]
}