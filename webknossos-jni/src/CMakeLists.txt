cmake_minimum_required(VERSION 3.12)

# Built by the webknossos-jni module in build.mill
# Define project and related variables. please use semantic versioning
project (webknossosJni)
set(PROJECT_VERSION_MAJOR 0)
set(PROJECT_VERSION_MINOR 0)
set(PROJECT_VERSION_PATCH 0)

find_package(draco REQUIRED)
find_package(JNI REQUIRED)
if (JNI_FOUND)
    message (STATUS "JNI include directories: ${JNI_INCLUDE_DIRS}")
endif()

include_directories(.)
include_directories(include)
include_directories(${JNI_INCLUDE_DIRS})

# Sources
file(GLOB LIB_SRC
  "*.c"
  "*.cc"
  "*.cpp"
)


# Setup installation targets
# major version should always be appended to library name (the datastore loads webknossosJni0)
set (LIB_NAME ${PROJECT_NAME}${PROJECT_VERSION_MAJOR})
add_library(${LIB_NAME} SHARED ${LIB_SRC})

target_link_libraries(${LIB_NAME} draco::draco)

install(TARGETS ${LIB_NAME} LIBRARY DESTINATION .)
