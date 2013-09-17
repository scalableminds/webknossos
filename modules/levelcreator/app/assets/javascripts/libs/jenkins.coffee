### define ###

Jenkins =
  rot: (x, k) ->
    (x << k) | (x >>> (32 - k))

  mix: (a, b, c) ->
    a = (a - c) | 0
    a ^= Jenkins.rot(c, 4)
    c = (c + b) | 0
    b = (b - a) | 0
    b ^= Jenkins.rot(a, 6)
    a = (a + c) | 0
    c = (c - b) | 0
    c ^= Jenkins.rot(b, 8)
    b = (b + a) | 0
    a = (a - c) | 0
    a ^= Jenkins.rot(c, 16)
    c = (c + b) | 0
    b = (b - a) | 0
    b ^= Jenkins.rot(a, 19)
    a = (a + c) | 0
    c = (c - b) | 0
    c ^= Jenkins.rot(b, 4)
    b = (b + a) | 0
    a: a
    b: b
    c: c

  final: (a, b, c) ->
    c ^= b
    c -= Jenkins.rot(b, 14) | 0
    a ^= c
    a -= Jenkins.rot(c, 11) | 0
    b ^= a
    b -= Jenkins.rot(a, 25) | 0
    c ^= b
    c -= Jenkins.rot(b, 16) | 0
    a ^= c
    a -= Jenkins.rot(c, 4) | 0
    b ^= a
    b -= Jenkins.rot(a, 14) | 0
    c ^= b
    c -= Jenkins.rot(b, 24) | 0
    a: a
    b: b
    c: c

  hashlittle2: (k, initval, initval2) ->
    length = k.length
    a = b = c = 0xdeadbeef + length + initval
    c += initval2
    offset = 0
    while length > 12
      a += (k.charCodeAt(offset + 0) + (k.charCodeAt(offset + 1) << 8) + (k.charCodeAt(offset + 2) << 16) + (k.charCodeAt(offset + 3) << 24))
      a = a >>> 0
      b += (k.charCodeAt(offset + 4) + (k.charCodeAt(offset + 5) << 8) + (k.charCodeAt(offset + 6) << 16) + (k.charCodeAt(offset + 7) << 24))
      b = b >>> 0
      c += (k.charCodeAt(offset + 8) + (k.charCodeAt(offset + 9) << 8) + (k.charCodeAt(offset + 10) << 16) + (k.charCodeAt(offset + 11) << 24))
      c = c >>> 0
      o = Jenkins.mix(a, b, c)
      a = o.a
      b = o.b
      c = o.c
      length -= 12
      offset += 12
    switch length
      when 12
        c += (k.charCodeAt(offset + 8) + (k.charCodeAt(offset + 9) << 8) + (k.charCodeAt(offset + 10) << 16) + (k.charCodeAt(offset + 11) << 24))
        b += (k.charCodeAt(offset + 4) + (k.charCodeAt(offset + 5) << 8) + (k.charCodeAt(offset + 6) << 16) + (k.charCodeAt(offset + 7) << 24))
        a += (k.charCodeAt(offset + 0) + (k.charCodeAt(offset + 1) << 8) + (k.charCodeAt(offset + 2) << 16) + (k.charCodeAt(offset + 3) << 24))
      when 11
        c += (k.charCodeAt(offset + 8) + (k.charCodeAt(offset + 9) << 8) + (k.charCodeAt(offset + 10) << 16))
        b += (k.charCodeAt(offset + 4) + (k.charCodeAt(offset + 5) << 8) + (k.charCodeAt(offset + 6) << 16) + (k.charCodeAt(offset + 7) << 24))
        a += (k.charCodeAt(offset + 0) + (k.charCodeAt(offset + 1) << 8) + (k.charCodeAt(offset + 2) << 16) + (k.charCodeAt(offset + 3) << 24))
      when 10
        c += (k.charCodeAt(offset + 8) + (k.charCodeAt(offset + 9) << 8))
        b += (k.charCodeAt(offset + 4) + (k.charCodeAt(offset + 5) << 8) + (k.charCodeAt(offset + 6) << 16) + (k.charCodeAt(offset + 7) << 24))
        a += (k.charCodeAt(offset + 0) + (k.charCodeAt(offset + 1) << 8) + (k.charCodeAt(offset + 2) << 16) + (k.charCodeAt(offset + 3) << 24))
      when 9
        c += (k.charCodeAt(offset + 8))
        b += (k.charCodeAt(offset + 4) + (k.charCodeAt(offset + 5) << 8) + (k.charCodeAt(offset + 6) << 16) + (k.charCodeAt(offset + 7) << 24))
        a += (k.charCodeAt(offset + 0) + (k.charCodeAt(offset + 1) << 8) + (k.charCodeAt(offset + 2) << 16) + (k.charCodeAt(offset + 3) << 24))
      when 8
        b += (k.charCodeAt(offset + 4) + (k.charCodeAt(offset + 5) << 8) + (k.charCodeAt(offset + 6) << 16) + (k.charCodeAt(offset + 7) << 24))
        a += (k.charCodeAt(offset + 0) + (k.charCodeAt(offset + 1) << 8) + (k.charCodeAt(offset + 2) << 16) + (k.charCodeAt(offset + 3) << 24))
      when 7
        b += (k.charCodeAt(offset + 4) + (k.charCodeAt(offset + 5) << 8) + (k.charCodeAt(offset + 6) << 16))
        a += (k.charCodeAt(offset + 0) + (k.charCodeAt(offset + 1) << 8) + (k.charCodeAt(offset + 2) << 16) + (k.charCodeAt(offset + 3) << 24))
      when 6
        b += ((k.charCodeAt(offset + 5) << 8) + k.charCodeAt(offset + 4))
        a += (k.charCodeAt(offset + 0) + (k.charCodeAt(offset + 1) << 8) + (k.charCodeAt(offset + 2) << 16) + (k.charCodeAt(offset + 3) << 24))
      when 5
        b += (k.charCodeAt(offset + 4))
        a += (k.charCodeAt(offset + 0) + (k.charCodeAt(offset + 1) << 8) + (k.charCodeAt(offset + 2) << 16) + (k.charCodeAt(offset + 3) << 24))
      when 4
        a += (k.charCodeAt(offset + 0) + (k.charCodeAt(offset + 1) << 8) + (k.charCodeAt(offset + 2) << 16) + (k.charCodeAt(offset + 3) << 24))
      when 3
        a += (k.charCodeAt(offset + 0) + (k.charCodeAt(offset + 1) << 8) + (k.charCodeAt(offset + 2) << 16))
      when 2
        a += (k.charCodeAt(offset + 0) + (k.charCodeAt(offset + 1) << 8))
      when 1
        a += (k.charCodeAt(offset + 0))
      when 0
        return (
          b: b
          c: c
        )
    o = Jenkins.final(a, b, c)
    a = o.a
    b = o.b
    c = o.c
    b: b >>> 0
    c: c >>> 0