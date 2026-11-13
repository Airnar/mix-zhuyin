//
//	Copyright (C) 2013 Hong Jen Yee (PCMan) <pcman.tw@gmail.com>
//
//	This library is free software; you can redistribute it and/or
//	modify it under the terms of the GNU Library General Public
//	License as published by the Free Software Foundation; either
//	version 2 of the License, or (at your option) any later version.
//
//	This library is distributed in the hope that it will be useful,
//	but WITHOUT ANY WARRANTY; without even the implied warranty of
//	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
//	Library General Public License for more details.
//
//	You should have received a copy of the GNU Library General Public
//	License along with this library; if not, write to the
//	Free Software Foundation, Inc., 51 Franklin St, Fifth Floor,
//	Boston, MA  02110-1301, USA.
//

#include "PIMEImeModule.h"
#include "JsonUtils.h"
#include "PIMETextService.h"
#include <string>
#include <fstream>
#include <cstring>
#include <ShlObj.h>
#include <Shellapi.h>
#include <Shlwapi.h>
#include <nlohmann/json.hpp>
#include "../libIME2/src/Utils.h"
#include "../libIME2/src/DisplayAttributeInfo.h"

using json = nlohmann::json;

namespace PIME {

namespace {
// CLSID of our Text service. MixZhuyin uses its own CLSID (not PIME's
// {35F67E9D-A54D-4177-9697-8B0AB71A9E04}) so it can be installed next to PIME.
// {A64DF4E9-E913-47D2-A89A-CF3134688E0D}
const GUID g_textServiceClsid = 
{ 0xa64df4e9, 0xe913, 0x47d2, { 0xa8, 0x9a, 0xcf, 0x31, 0x34, 0x68, 0x8e, 0x0d } };

// {52A98687-0008-48BD-917F-DD4B0457DB2D}
static const GUID g_inputDisplayAttributeGuid = 
{ 0x52a98687, 0x0008, 0x48bd, { 0x91, 0x7f, 0xdd, 0x4b, 0x04, 0x57, 0xdb, 0x2d } };

static std::vector<Ime::ComPtr<Ime::DisplayAttributeInfo>> createDisplayAttrInfos() {
    auto inputAttrib = Ime::ComPtr<Ime::DisplayAttributeInfo>::make(g_inputDisplayAttributeGuid);
    inputAttrib->setLineStyle(TF_LS_DOT);
	return {std::move(inputAttrib)};
}

}

ImeModule::ImeModule(HMODULE module):
	Ime::ImeModule(module, g_textServiceClsid, createDisplayAttrInfos()) {
	wchar_t path[MAX_PATH];
	// The program directory is the parent of the folder holding this DLL
	// (<program dir>\x86, \x64 or \arm64), wherever the installer put it.
	DWORD pathLen = ::GetModuleFileNameW(module, path, MAX_PATH);
	if (pathLen > 0 && pathLen < MAX_PATH &&
		::PathRemoveFileSpecW(path) && ::PathRemoveFileSpecW(path)) {
		programDir_ = path;

		// load backend information
		std::ifstream fp(programDir_ + L"\\backends.json", std::ifstream::binary);
		if (fp) {
			json backendsInfo = parseJsonNoThrow(fp);
			if (backendsInfo.is_array()) {
				for (const auto& backend: backendsInfo) {
					if (!backend.is_object()) {
						continue;
					}
					std::string nameUtf8 = jsonValueOr<std::string>(backend, "name", "");
					if (!nameUtf8.empty()) {
						std::wstring name = utf8ToUtf16(nameUtf8.c_str());
						backendDirs_.push_back(name);
					}
				}
			}
		}
	}
}

ImeModule::~ImeModule(void) {
}

// virtual
Ime::TextService* ImeModule::createTextService() {
	TextService* service = new PIME::TextService(this);
	return service;
}

bool ImeModule::loadImeInfo(const std::string& guid, std::wstring& filePath, json& content) {
	bool found = false;
	// find the input method module
	for (const auto backendDir : backendDirs_) {
		std::wstring dirPath = programDir_;
		dirPath += '\\';
		dirPath += backendDir;
		dirPath += L"\\input_methods";
		// scan the dir for lang profile definition files
		WIN32_FIND_DATA findData = { 0 };
		HANDLE hFind = ::FindFirstFile((dirPath + L"\\*").c_str(), &findData);
		if (hFind != INVALID_HANDLE_VALUE) {
			do {
				if (findData.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) { // this is a subdir
					if (findData.cFileName[0] != '.') {
						std::wstring imejson = dirPath;
						imejson += '\\';
						imejson += findData.cFileName;
						imejson += L"\\ime.json";
						std::ifstream fp(imejson, std::ifstream::binary);
						if (fp) {
							content = parseJsonNoThrow(fp);
							if (!content.is_object() || content.is_discarded()) {
								continue;
							}
							std::string imeGuid = jsonValueOr<std::string>(content, "guid", "");
							if (stricmp(guid.c_str(), imeGuid.c_str()) == 0) {
								// found the language profile
								found = true;
								filePath = imejson;
								break;
							}
						}
					}
				}
			} while (::FindNextFile(hFind, &findData));
			::FindClose(hFind);
		}
		if (found)
			break;
	}
	return found;
}

// virtual
bool ImeModule::onConfigure(HWND hwndParent, LANGID langid, REFGUID rguidProfile) {
	// FIXME: this is inefficient. Should we cache known modules?
	LPOLESTR pGuidStr = NULL;
	if (FAILED(::StringFromCLSID(rguidProfile, &pGuidStr)))
		return false;
	std::string guidStr = utf16ToUtf8(pGuidStr);
	CoTaskMemFree(pGuidStr);

	std::wstring configCommand;
	std::wstring configParams;
	std::wstring configDir;

	// find the input method module
	std::wstring infoFilePath;
	json info;
	if (loadImeInfo(guidStr, infoFilePath, info)) {
		std::wstring currentDir = infoFilePath.substr(0, infoFilePath.length() - 8); // remove "ime.json" from file path
		configCommand = utf8ToUtf16(jsonValueOr<std::string>(info, "configTool", "").c_str());
		configParams = utf8ToUtf16(jsonValueOr<std::string>(info, "configToolParams", "").c_str());
		configDir = utf8ToUtf16(jsonValueOr<std::string>(info, "configToolDir", "").c_str());
		// for some mysterious reasons, relative paths do not work here (according to Win32 API doc it should work).
		if (PathIsRelative(configCommand.c_str())) {  // convert it to an absolute path
			wchar_t absPath[MAX_PATH];
			PathCanonicalize(absPath, (currentDir + configCommand).c_str());
			configCommand = absPath;
		}
		if (!configDir.empty()) {
			if (PathIsRelative(configDir.c_str())) {  // convert it to an absolute path
				wchar_t absPath[MAX_PATH];
				PathCanonicalize(absPath, (currentDir + configDir).c_str());
				configDir = absPath;
			}
		}
	}

	if (!configCommand.empty()) { // command line is found
		// execute the config tool. MixZhuyin's is node.exe running
		// config_tool.js, which opens the browser itself: hide its console.
		::ShellExecuteW(hwndParent, L"open", 
			configCommand.c_str(),
			configParams.empty() ? NULL : configParams.c_str(),
			configDir.empty() ? NULL : configDir.c_str(),
			SW_HIDE);
	}
	else {
		// FIXME: this message should be localized.
		::MessageBoxW(hwndParent, L"The input module does not have a config tool.", NULL, MB_OK);
	}
	return true;
}


} // namespace PIME
