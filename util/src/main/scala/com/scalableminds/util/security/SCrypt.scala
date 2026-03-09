package com.scalableminds.util.security

import java.nio.charset.StandardCharsets
import at.favre.lib.crypto.bcrypt.BCrypt

/**
  * Making BCrypt look prettier
  */
object SCrypt {

  import java.security.MessageDigest

  /**
    * For readability.
    */
  private type PlainPassword = String
  private type PasswordHash = String

  /**
    * Useful salting default
    */
  private val QuickAndWeak = 6
  private val GoodEnough = 10
  private val RatherTough = 14
  private val PrettyInsane = 18

  /**
    *
    * @param rounds this is the base of log2 of the number of salting rounds. Legal values are >=4, sane values are leq 20
    */
  def hashPassword(password: PlainPassword, rounds: Int = GoodEnough): PasswordHash = {

    if (rounds < 4 || rounds > 20)
      throw new IllegalArgumentException("""As the number of operations grows
                                              	 |with 2^rounds, legal/sane values of rounds are in fixed in (4..20).
                                              |Smaller is less secure, larger is significantly slower""".stripMargin)

    val bcryptHashBytes = BCrypt.withDefaults.hash(rounds, password.getBytes(StandardCharsets.UTF_8))
    new String(bcryptHashBytes, StandardCharsets.UTF_8)
  }

  def verifyPassword(plainTextPassword: PlainPassword, hashedPassword: PasswordHash): Boolean =
    BCrypt.verifyer
      .verify(plainTextPassword.getBytes(StandardCharsets.UTF_8), hashedPassword.getBytes(StandardCharsets.UTF_8))
      .verified

  def md5(s: String): String =
    MessageDigest.getInstance("MD5").digest(s.getBytes).map("%02X".format(_)).mkString

  def sha256Hex(s: String): String =
    MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)).map("%02x".format(_)).mkString
}
