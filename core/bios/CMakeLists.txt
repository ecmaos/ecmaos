cmake_minimum_required(VERSION 3.13.4)
project(bios)

set(CMAKE_TOOLCHAIN_FILE $ENV{EMSDK}/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake)
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -s WASM=1 -s EXPORTED_RUNTIME_METHODS=['ccall','cwrap','FS'] -s EXPORTED_FUNCTIONS=['_malloc','_free','_init','_get_version','_execute','_execute_with_output','_get_last_status','_write_file','_read_file','_file_exists','_delete_file','_list_directory'] -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME=createBIOS")

add_executable(bios
    src/bios.cpp
)

set_target_properties(bios PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/dist"
)

add_subdirectory(src/commands)
target_link_libraries(bios PRIVATE commands)
