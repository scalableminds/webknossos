package com.scalableminds.util.security

import java.nio.charset.StandardCharsets
import at.favre.lib.crypto.bcrypt.{BCrypt, LongPasswordStrategies}

/** Making BCrypt look prettier
  */
object SCrypt {

  import java.security.MessageDigest

  /** For readability.
    */
  private type PlainPassword = String
  private type PasswordHash = String

  // Like jBCrypt (used before #7335), ignore bytes beyond 72, so that old hashes of longer passwords still verify
  private val version = BCrypt.Version.VERSION_2A
  private val longPasswordStrategy = LongPasswordStrategies.truncate(version)

  /** @param rounds
    *   this is the base of log2 of the number of salting rounds. Legal values are >=4, sane values are leq 20
    */
  def hashPassword(password: PlainPassword, rounds: Int = 10): PasswordHash = {

    if (rounds < 4 || rounds > 20)
      throw new IllegalArgumentException("""As the number of operations grows
                                              	 |with 2^rounds, legal/sane values of rounds are in fixed in (4..20).
                                              |Smaller is less secure, larger is significantly slower""".stripMargin)

    val bcryptHashBytes =
      BCrypt.`with`(version, longPasswordStrategy).hash(rounds, password.getBytes(StandardCharsets.UTF_8))
    new String(bcryptHashBytes, StandardCharsets.UTF_8)
  }

  def verifyPassword(plainTextPassword: PlainPassword, hashedPassword: PasswordHash): Boolean =
    BCrypt
      .verifyer(version, longPasswordStrategy)
      .verify(plainTextPassword.getBytes(StandardCharsets.UTF_8), hashedPassword.getBytes(StandardCharsets.UTF_8))
      .verified

  def md5(s: String): String =
    MessageDigest.getInstance("MD5").digest(s.getBytes).map("%02X".format(_)).mkString

  def sha256Hex(s: String): String =
    MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)).map("%02x".format(_)).mkString
}
