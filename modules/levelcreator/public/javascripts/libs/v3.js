/* -*- Mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil; tab-width: 40; -*- */
/*
 * Copyright (c) 2010 Mozilla Corporation
 * Copyright (c) 2010 Vladimir Vukicevic
 *
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software and associated documentation
 * files (the "Software"), to deal in the Software without
 * restriction, including without limitation the rights to use,
 * copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following
 * conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 * OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 * WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
 * OTHER DEALINGS IN THE SOFTWARE.
 */

/*
 * File: mjs
 *
 * Vector and Matrix math utilities for JavaScript, optimized for WebGL.
 */

/*
 * Constant: MJS_VERSION
 *
 * mjs version number aa.bb.cc, encoded as an integer of the form:
 * 0xaabbcc.
 */
var MJS_VERSION = 0x000000;
var MJS_EPSILON = 0.00001;

/*
 * Constant: MJS_DO_ASSERT
 *
 * Enables or disables runtime assertions.
 *
 * For potentially more performance, the assert methods can be
 * commented out in each place where they are called.
 */
var MJS_DO_ASSERT = true;

// Some hacks for running in both the shell and browser,
// and for supporting F32 and WebGLFloat arrays
//try { WebGLFloatArray; } catch (x) { WebGLFloatArray = Float32Array; }

/*
 * Constant: MJS_FLOAT_ARRAY_TYPE
 *
 * The base float array type.  By default, WebGLFloatArray.
 *
 * mjs can work with any array-like elements, but if an array
 * creation is requested, it will create an array of the type
 * MJS_FLOAT_ARRAY_TYPE.  Also, the builtin constants such as (M4x4.I)
 * will be of this type.
 */
var MJS_FLOAT_ARRAY_TYPE = Float32Array;
//const MJS_FLOAT_ARRAY_TYPE = Float32Array;
//const MJS_FLOAT_ARRAY_TYPE = Float64Array;
//const MJS_FLOAT_ARRAY_TYPE = Array;

/*if (MJS_DO_ASSERT) {
function MathUtils_assert(cond, msg) {
    if (!cond){
        throw "Assertion failed: " + msg;
        }
}
} else {
function MathUtils_assert() { }
}*/

/*
 * Class: V3
 *
 * Methods for working with 3-element vectors.  A vector is represented by a 3-element array.
 * Any valid JavaScript array type may be used, but if new
 * vectors are created they are created using the configured MJS_FLOAT_ARRAY_TYPE.
 */

var V3 = { };

V3._temp1 = new MJS_FLOAT_ARRAY_TYPE(3);
V3._temp2 = new MJS_FLOAT_ARRAY_TYPE(3);
V3._temp3 = new MJS_FLOAT_ARRAY_TYPE(3);

if (MJS_FLOAT_ARRAY_TYPE === Array) {
  V3.x = [1.0, 0.0, 0.0];
  V3.y = [0.0, 1.0, 0.0];
  V3.z = [0.0, 0.0, 1.0];

  V3.$ = function V3_$(x, y, z) {
      return [x, y, z];
  };

  V3.clone = function V3_clone(a) {
      //MathUtils_assert(a.length === 3, "a.length === 3");
      return [a[0], a[1], a[2]];
    };
} else {
  V3.x = new MJS_FLOAT_ARRAY_TYPE([1.0, 0.0, 0.0]);
  V3.y = new MJS_FLOAT_ARRAY_TYPE([0.0, 1.0, 0.0]);
  V3.z = new MJS_FLOAT_ARRAY_TYPE([0.0, 0.0, 1.0]);

/*
* Function: V3.$
*
* Creates a new 3-element vector with the given values.
*
* Parameters:
*
*   x,y,z - the 3 elements of the new vector.
*
* Returns:
*
* A new vector containing with the given argument values.
*/

  V3.$ = function V3_$(x, y, z) {
      return new MJS_FLOAT_ARRAY_TYPE([x, y, z]);
  };

/*
* Function: V3.clone
*
* Clone the given 3-element vector.
*
* Parameters:
*
*   a - the 3-element vector to clone
*
* Returns:
*
* A new vector with the same values as the passed-in one.
*/

  V3.clone = function V3_clone(a) {
      //MathUtils_assert(a.length === 3, "a.length === 3");
      return new MJS_FLOAT_ARRAY_TYPE(a);
  };
}

V3.u = V3.x;
V3.v = V3.y;

/*
 * Function: V3.add
 *
 * Perform r = a + b.
 *
 * Parameters:
 *
 *   a - the first vector operand
 *   b - the second vector operand
 *   r - optional vector to store the result in
 *
 * Returns:
 *
 *   If r is specified, returns r after performing the operation.
 *   Otherwise, returns a new 3-element vector with the result.
 */
V3.add = function V3_add(a, b, r) {
  //MathUtils_assert(a.length === 3, "a.length === 3");
  //MathUtils_assert(b.length === 3, "b.length === 3");
  //MathUtils_assert(r === undefined || r.length === 3, "r === undefined || r.length === 3");

  if (r === undefined){
      r = new MJS_FLOAT_ARRAY_TYPE(3);
      }
  r[0] = a[0] + b[0];
  r[1] = a[1] + b[1];
  r[2] = a[2] + b[2];
  return r;
};

/*
*/
V3.equals = function V3_equals(a, b){
  if( Math.abs(a[0] - b[0]) < MJS_EPSILON &&
      Math.abs(a[1] - b[1]) < MJS_EPSILON &&
      Math.abs(a[2] - b[2]) < MJS_EPSILON)
  {
    return true;
  }
  return false;
};

/*
 * Function: V3.sub
 *
 * Perform
 * r = a - b.
 *
 * Parameters:
 *
 *   a - the first vector operand
 *   b - the second vector operand
 *   r - optional vector to store the result in
 *
 * Returns:
 *
 *   If r is specified, returns r after performing the operation.
 *   Otherwise, returns a new 3-element vector with the result.
 */
V3.sub = function V3_sub(a, b, r) {
  //MathUtils_assert(a.length === 3, "a.length === 3");
  //MathUtils_assert(b.length === 3, "b.length === 3");
  //MathUtils_assert(r === undefined || r.length === 3, "r === undefined || r.length === 3");

  if (r === undefined){
      r = new MJS_FLOAT_ARRAY_TYPE(3);
      }
  r[0] = a[0] - b[0];
  r[1] = a[1] - b[1];
  r[2] = a[2] - b[2];
  return r;
};

/*
 * Function: V3.neg
 *
 * Perform
 * r = - a.
 *
 * Parameters:
 *
 *   a - the vector operand
 *   r - optional vector to store the result in
 *
 * Returns:
 *
 *   If r is specified, returns r after performing the operation.
 *   Otherwise, returns a new 3-element vector with the result.
 */
V3.neg = function V3_neg(a, r) {
  //MathUtils_assert(a.length === 3, "a.length === 3");
  //MathUtils_assert(r === undefined || r.length === 3, "r === undefined || r.length === 3");

  if (r === undefined){
      r = new MJS_FLOAT_ARRAY_TYPE(3);
      }
  r[0] = - a[0];
  r[1] = - a[1];
  r[2] = - a[2];
  return r;
};

/*
 * Function: V3.direction
 *
 * Perform
 * r = (a - b) / |a - b|.  The result is the normalized
 * direction from a to b.
 *
 * Parameters:
 *
 *   a - the first vector operand
 *   b - the second vector operand
 *   r - optional vector to store the result in
 *
 * Returns:
 *
 *   If r is specified, returns r after performing the operation.
 *   Otherwise, returns a new 3-element vector with the result.
 */
V3.direction = function V3_direction(a, b, r) {
  //MathUtils_assert(a.length === 3, "a.length === 3");
  //MathUtils_assert(b.length === 3, "b.length === 3");
  //MathUtils_assert(r === undefined || r.length === 3, "r === undefined || r.length === 3");

  if (r === undefined){
      r = new MJS_FLOAT_ARRAY_TYPE(3);
      }
  return V3.normalize(V3.sub(a, b, r), r);
};

/*
 * Function: V3.length
 *
 * Perform r = |a|.
 *
 * Parameters:
 *
 *   a - the vector operand
 *
 * Returns:
 *
 *   The length of the given vector.
 */
V3.length = function V3_length(a) {
  //MathUtils_assert(a.length === 3, "a.length === 3");

  return Math.sqrt(a[0]*a[0] + a[1]*a[1] + a[2]*a[2]);
};

/*
 * Function: V3.lengthSquard
 *
 * Perform r = |a|*|a|.
 *
 * Parameters:
 *
 *   a - the vector operand
 *
 * Returns:
 *
 *   The square of the length of the given vector.
 */
V3.lengthSquared = function V3_lengthSquared(a) {
  //MathUtils_assert(a.length === 3, "a.length === 3");

  return a[0]*a[0] + a[1]*a[1] + a[2]*a[2];
};

/*
 * Function: V3.normalize
 *
 * Perform r = a / |a|.
 *
 * Parameters:
 *
 *   a - the vector operand
 *   r - optional vector to store the result in
 *
 * Returns:
 *
 *   If r is specified, returns r after performing the operation.
 *   Otherwise, returns a new 3-element vector with the result.
 */
V3.normalize = function V3_normalize(a, r) {
  //MathUtils_assert(a.length === 3, "a.length === 3");
  //MathUtils_assert(r === undefined || r.length === 3, "r === undefined || r.length === 3");

  if (r === undefined){
      r = new MJS_FLOAT_ARRAY_TYPE(3);
      }
  var im = 1.0 / V3.length(a);
  r[0] = a[0] * im;
  r[1] = a[1] * im;
  r[2] = a[2] * im;
  return r;
};

/*
 * Function: V3.scale
 *
 * Perform r = a * k.
 *
 * Parameters:
 *
 *   a - the vector operand
 *   k - a scalar value
 *   r - optional vector to store the result in
 *
 * Returns:
 *
 *   If r is specified, returns r after performing the operation.
 *   Otherwise, returns a new 3-element vector with the result.
 */
V3.scale = function V3_scale(a, k, r) {
  //MathUtils_assert(a.length === 3, "a.length === 3");
  //MathUtils_assert(r === undefined || r.length === 3, "r === undefined || r.length === 3");

  if (r === undefined){
      r = new MJS_FLOAT_ARRAY_TYPE(3);
      }
  r[0] = a[0] * k;
  r[1] = a[1] * k;
  r[2] = a[2] * k;
  return r;
};

/*
 * Function: V3.dot
 *
 * Perform
 * r = dot(a, b).
 *
 * Parameters:
 *
 *   a - the first vector operand
 *   b - the second vector operand
 *
 * Returns:
 *
 *   The dot product of a and b.
 */
V3.dot = function V3_dot(a, b) {
  //MathUtils_assert(a.length === 3, "a.length === 3");
  //MathUtils_assert(b.length === 3, "b.length === 3");

  return a[0] * b[0] +
      a[1] * b[1] +
      a[2] * b[2];
};

/*
 * Function: V3.cross
 *
 * Perform r = a x b.
 *
 * Parameters:
 *
 *   a - the first vector operand
 *   b - the second vector operand
 *   r - optional vector to store the result in
 *
 * Returns:
 *
 *   If r is specified, returns r after performing the operation.
 *   Otherwise, returns a new 3-element vector with the result.
 */
V3.cross = function V3_cross(a, b, r) {
  //MathUtils_assert(a.length === 3, "a.length === 3");
  //MathUtils_assert(b.length === 3, "b.length === 3");
  //MathUtils_assert(r === undefined || r.length === 3, "r === undefined || r.length === 3");

  if (r === undefined){
      r = new MJS_FLOAT_ARRAY_TYPE(3);
      }
  r[0] = a[1]*b[2] - a[2]*b[1];
  r[1] = a[2]*b[0] - a[0]*b[2];
  r[2] = a[0]*b[1] - a[1]*b[0];
  return r;
};

/*
*/
V3.angle = function V3_angle(a, b){
  return Math.acos(V3.dot(a, b));
};

/*
 * Function: V3.mul4x4
 *
 * Perform
 * r = m * v.
 *
 * Parameters:
 *
 *   m - the 4x4 matrix operand
 *   v - the 3-element vector operand
 *   r - optional vector to store the result in
 *
 * Returns:
 *
 *   If r is specified, returns r after performing the operation.
 *   Otherwise, returns a new 3-element vector with the result.
 *   The 4-element result vector is divided by the w component
 *   and returned as a 3-element vector.
 */
V3.mul4x4 = function V3_mul4x4(m, v, r) {
  //MathUtils_assert(m.length === 16, "m.length === 16");
  //MathUtils_assert(v.length === 3, "v.length === 3");
  //MathUtils_assert(r === undefined || r.length === 3, "r === undefined || r.length === 3");

  var w;
  var tmp = V3._temp1;
  if (r === undefined){
      r = new MJS_FLOAT_ARRAY_TYPE(3);
      }
  tmp[0] = m[ 3];
  tmp[1] = m[ 7];
  tmp[2] = m[11];
  w    =  V3.dot(v, tmp) + m[15];
  tmp[0] = m[ 0];
  tmp[1] = m[ 4];
  tmp[2] = m[ 8];
  r[0] = (V3.dot(v, tmp) + m[12])/w;
  tmp[0] = m[ 1];
  tmp[1] = m[ 5];
  tmp[2] = m[ 9];
  r[1] = (V3.dot(v, tmp) + m[13])/w;
  tmp[0] = m[ 2];
  tmp[1] = m[ 6];
  tmp[2] = m[10];
  r[2] = (V3.dot(v, tmp) + m[14])/w;
  return r;
};
