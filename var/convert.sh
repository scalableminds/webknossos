python var/convert_obj_three.py -i public/mesh/crosshair.obj -o public/mesh/crosshair.js -t ascii -s smooth -a bottom
python var/convert_obj_three.py -i public/mesh/coordinateAxes.obj -o public/mesh/coordinateAxes.js -t ascii -s smooth -a bottom


:<<COMMENT
-------------------------
How to use this converter
-------------------------

python convert_obj_three.py -i infile.obj -o outfile.js [-m "morphfiles*.obj"] [-c "morphcolors*.obj"] [-a center|centerxz|top|bottom|none] [-s smooth|flat] [-t ascii|binary] [-d invert|normal] [-b] [-e]

Notes:
    - flags
        -i infile.obj			input OBJ file
        -o outfile.js			output JS file
        -m "morphfiles*.obj"	morph OBJ files (can use wildcards, enclosed in quotes multiple patterns separate by space)
        -c "morphcolors*.obj"	morph colors OBJ files (can use wildcards, enclosed in quotes multiple patterns separate by space)
        -a center|centerxz|top|bottom|none model alignment
        -s smooth|flat			smooth = export vertex normals, flat = no normals (face normals computed in loader)
        -t ascii|binary			export ascii or binary format (ascii has more features, binary just supports vertices, faces, normals, uvs and materials)
        -d invert|normal		invert transparency
        -b						bake material colors into face colors
        -x 10.0                 scale and truncate
        -f 2                    morph frame sampling step

    - by default:
        use smooth shading (if there were vertex normals in the original model)
        will be in ASCII format
        original model is assumed to use non-inverted transparency / dissolve (0.0 fully transparent, 1.0 fully opaque)
        no face colors baking
        no scale and truncate
        morph frame step = 1 (all files will be processed)

    - binary conversion will create two files:
        outfile.js  (materials)
        outfile.bin (binary buffers)
COMMENT