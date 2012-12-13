define(function () {
/*
  This file is part of the Ofi Labs X2 project.

  Copyright (C) 2011 Ariya Hidayat <ariya.hidayat@gmail.com>
  Copyright (C) 2010 Ariya Hidayat <ariya.hidayat@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * Neither the name of the <organization> nor the
      names of its contributors may be used to endorse or promote products
      derived from this software without specific prior written permission.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

/*jslint browser: true, sloppy: true, indent: 4 */

function KineticModel() {

    var min = 0,
        max = 1000,
        timeConstant,
        ticker,
        lastPosition = 0,
        velocity = 0,
        timestamp = Date.now();

    function clamped(pos) {
        return (pos > max) ? max : (pos < min) ? min : pos;
    }

    function nop() {}

    this.duration = 1950;
    this.position = 0;
    this.updateInterval = 1000 / 60;

    this.onPositionChanged = nop;
    this.onScrollStarted = nop;
    this.onScrollStopped = nop;


    this.setRange = function (start, end) {
        min = start;
        max = end;
    };

    this.getRange = function () {
        return {
            minimum: min,
            maximum: max
        };
    };

    this.setPosition = function (pos) {
        var self = this;

        this.position = clamped(pos);
        this.onPositionChanged(this.position);

        if (!ticker) {
            // Track down the movement to compute the initial
            // scrolling velocity.
            ticker = window.setInterval(function () {
                var now = Date.now(),
                    elapsed = now - timestamp,
                    v = (self.position - lastPosition) * 1000 / elapsed;

                // Moving average to filter the speed.
                if (ticker && elapsed >= self.updateInterval) {
                    timestamp = now;
                    if (v > 1 || v < -1) {
                        velocity = 0.2 * (velocity) + 0.8 * v;
                        lastPosition = self.position;
                    }
                }
            }, this.updateInterval);
        }
    };

    this.resetSpeed = function () {
        velocity = 0;
        lastPosition = this.position;

        window.clearInterval(ticker);
        ticker = null;
    };

    this.release = function () {
        var self = this,
            amplitude = velocity,
            targetPosition = this.position + amplitude,
            timeConstant = 1 + this.duration / 6,
            timestamp = Date.now();

        window.clearInterval(ticker);
        ticker = null;

        if (velocity > 1 || velocity < -1) {

            this.onScrollStarted(self.position);

            window.clearInterval(ticker);
            ticker = window.setInterval(function () {
                var elapsed = Date.now() - timestamp;

                if (ticker) {
                    self.position = targetPosition - amplitude * Math.exp(-elapsed / timeConstant);
                    self.position = clamped(self.position);
                    self.onPositionChanged(self.position);

                    if (elapsed > self.duration) {
                        self.resetSpeed();
                        self.onScrollStopped(self.position);
                    }
                }
            }, this.updateInterval);
        }
    };
}
return KineticModel;});