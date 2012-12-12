define ->
  
  inverse : (mat) ->

    a00 = mat[0]
    a10 = mat[1]
    a20 = mat[2]

    a01 = mat[3]
    a11 = mat[4]
    a21 = mat[5]

    a02 = mat[6]
    a12 = mat[7]
    a22 = mat[8]

    det = 
      a00*(a11*a22-a21*a12) - 
      a01*(a10*a22-a12*a20) +
      a02*(a10*a21-a11*a20)

    invdet = 1 / det

    [
       (a11*a22-a21*a12)*invdet
      -(a10*a22-a12*a20)*invdet
       (a10*a21-a20*a11)*invdet
      

      -(a01*a22-a02*a21)*invdet
       (a00*a22-a02*a20)*invdet
      -(a00*a21-a20*a01)*invdet
      

       (a01*a12-a02*a11)*invdet
      -(a00*a12-a10*a02)*invdet
       (a00*a11-a10*a01)*invdet
    ]

  multiply : (a, b) ->

    a00 = a[0]
    a10 = a[1]
    a20 = a[2]

    a01 = a[3]
    a11 = a[4]
    a21 = a[5]

    a02 = a[6]
    a12 = a[7]
    a22 = a[8]

    b00 = b[0]
    b10 = b[1]
    b20 = b[2]

    b01 = b[3]
    b11 = b[4]
    b21 = b[5]

    b02 = b[6]
    b12 = b[7]
    b22 = b[8]

    [
      a00 * b00 + a01 * b10 + a02 * b20
      a10 * b00 + a11 * b10 + a12 * b20
      a20 * b00 + a21 * b10 + a22 * b20

      a00 * b01 + a01 * b11 + a02 * b21
      a10 * b01 + a11 * b11 + a12 * b21
      a20 * b01 + a21 * b11 + a22 * b21

      a00 * b02 + a01 * b12 + a02 * b22
      a10 * b02 + a11 * b12 + a12 * b22
      a20 * b02 + a21 * b12 + a22 * b22
    ]


  transformPoint : (mat, x, y) ->

    x : x * mat[0] + y * mat[1] + mat[2]
    y : x * mat[3] + y * mat[4] + mat[5]


  transformLine : (mat, x, y) ->

    x : x * mat[0] + y * mat[1]
    y : x * mat[3] + y * mat[4]


  translate : (mat, x, y) ->

    @multiply( mat, [
        1, 0, x
        0, 1, y
        0, 0, 1
      ]
    )

  scale : (mat, s) ->

    @multiply( mat, [
        s, 0, 0
        0, s, 0
        0, 0, 1
      ]
    )