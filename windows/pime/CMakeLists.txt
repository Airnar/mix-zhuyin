cmake_minimum_required(VERSION 3.19)

# Policy CMP0091 enables CMAKE_MSVC_RUNTIME_LIBRARY
cmake_policy(SET CMP0091 NEW)

# Statically link MSVC CRT (/MT in Release, /MTd in Debug) across all targets
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

project(MixZhuyinTextService)

# MixZhuyin's version comes from its ime.json, the single source of truth.
file(READ "${PROJECT_SOURCE_DIR}/../../output/pime/ime.json" MIXZHUYIN_IME_JSON)
string(JSON PIME_VERSION GET "${MIXZHUYIN_IME_JSON}" version)
# we use semantic versioning: <major>.<minor>.<patch>[-<some suffix>]
# convert the version string into a list (separated by ;)
string(REGEX MATCHALL "[0-9]+" PIME_VERSION_PARTS "${PIME_VERSION}")
list(GET PIME_VERSION_PARTS 0 PIME_VERSION_MAJOR)
list(GET PIME_VERSION_PARTS 1 PIME_VERSION_MINOR)
list(GET PIME_VERSION_PARTS 2 PIME_VERSION_PATCH)

# http://www.utf8everywhere.org/
add_definitions(
	/D_UNICODE=1 /DUNICODE=1 # do Unicode build
	/D_CRT_SECURE_NO_WARNINGS # disable warnings about old libc functions
	/GR- # turn off C++ RTTI
    -DWIN32_LEAN_AND_MEAN
    -D_WIN32_WINNT=0x0600
)

add_subdirectory(${PROJECT_SOURCE_DIR}/libIME2/src)

add_subdirectory(${PROJECT_SOURCE_DIR}/PIMETextService)

# The launcher (PIMELauncher/) is built with cargo directly; see
# windows/build_all_in_one.ps1. Upstream's tests are not part of this copy.
