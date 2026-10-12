These fixtures replay the actual repository JNI converter and compiled Scala geometry/mapping
implementations; the Rust datastore does not load native libraries or Scala.

- real_{11,30,33}.drc: fragments from fixtures/meshes/real.hdf5, sliced using actual Scala manifest
  byte offsets. Corresponding .stlraw use offset [10.25,-20.5,0.125], scale [2.5,0.75,4];
  _full.stlraw use zero offset and unit scale as the original mesh container declares.
- float_{sequential,edgebreaker}.drc: native Draco1.5.7 encodings with POSITION quantization14.
- integer_{sequential,edgebreaker}.drc: native UInt32 positions and external quantization10.
  Integer _full.stlraw use zero offset, scale [2.5,0.75,4]. Native STL normals precede affine scale.
- cubes.bin: actual compiled Scala MarchingCubes, all256 memberships. Each record starts with a
  UInt32 float count, then little-endian Float32 vertices. Nontrivial offset/anisotropic scale.
- tiled.bin: Scala triangle ordering across three 32-cell tile planes.
- route_cube.bin, indexed.stlraw, bfs.stlraw: compiled Scala geometry for HTTP cuboids, indexed
  meshing and two-wave129-sample/128-cell BFS. BFS raw STL is second wave then first wave.
- adhoc.stlraw: actual FullMeshHelper, including its historical faceIndex normal indexing bug.
- areas.json / areas_play.json: compiled FullMeshHelper raw-STL area; Java float text / Play JSON.
- mapping.json / mapping_oracle.json: actual Scala MappingParser narrowing/duplicates/numeric strings
  at four storage widths, with identity fallback handled by the service.

Oracle sources live in backend-rust/tools: draco_fixture_encoder.cpp, GenerateDracoFixtures.java,
GenerateStlGeometryFixtures.java, GenerateJsonMappingFixtures.java. JNI oracle links the unchanged
repository webknossos-jni/src/dracoToStlDecoder.cpp + jniutils.cpp against Homebrew Draco1.5.7
(-std=c++17 -ffp-contract=off, JDK JNI headers). See the DS5 checkpoint for temporary paths.
The Java helpers use webknossos-datastore/target/scala-3.8.4/classes and its exported dependency
classpath; the native helper needs --enable-native-access=ALL-UNNAMED. Replay uses cargo only.
Mesh containers in ../full_mesh are generated with generate_full_mesh_fixtures.py and h5py/numpy.
