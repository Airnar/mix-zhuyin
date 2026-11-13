//
//    Copyright (C) 2026 MixZhuyin developers
//
//    This library is free software; you can redistribute it and/or
//    modify it under the terms of the GNU Library General Public
//    License as published by the Free Software Foundation; either
//    version 2 of the License, or (at your option) any later version.
//
//    This library is distributed in the hope that it will be useful,
//    but WITHOUT ANY WARRANTY; without even the implied warranty of
//    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
//    Library General Public License for more details.
//

#include "ImeTheme.h"

#include <dwmapi.h>

namespace Ime {

namespace {

// DWMWINDOWATTRIBUTE values from the Windows 11 SDK, spelled out so older
// SDKs still build. Older Windows rejects them and we draw a border instead.
constexpr DWORD kDwmWindowCornerPreference = 33; // DWMWA_WINDOW_CORNER_PREFERENCE
constexpr DWORD kDwmBorderColor = 34;            // DWMWA_BORDER_COLOR
constexpr DWORD kDwmCornerRound = 2;             // DWMWCP_ROUND

bool appsUseLightTheme() {
    DWORD value = 1;
    DWORD size = sizeof(value);
    LSTATUS status = ::RegGetValueW(HKEY_CURRENT_USER,
        L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
        L"AppsUseLightTheme", RRF_RT_REG_DWORD, nullptr, &value, &size);
    return status != ERROR_SUCCESS || value != 0;
}

bool highContrastOn() {
    HIGHCONTRASTW hc = { sizeof(hc) };
    return ::SystemParametersInfoW(SPI_GETHIGHCONTRAST, sizeof(hc), &hc, 0) &&
        (hc.dwFlags & HCF_HIGHCONTRASTON) != 0;
}

} // namespace

ImeTheme currentImeTheme() {
    if (highContrastOn()) {
        // Respect the user's High Contrast colors.
        return ImeTheme{
            ::GetSysColor(COLOR_WINDOW),
            ::GetSysColor(COLOR_WINDOWTEXT),
            ::GetSysColor(COLOR_WINDOWTEXT),
            ::GetSysColor(COLOR_WINDOWTEXT),
            ::GetSysColor(COLOR_HIGHLIGHT),
            ::GetSysColor(COLOR_HIGHLIGHTTEXT),
            ::GetSysColor(COLOR_HIGHLIGHT),
            true,
        };
    }
    if (!appsUseLightTheme()) {
        return ImeTheme{
            RGB(44, 44, 44),    // background
            RGB(72, 72, 72),    // border
            RGB(243, 243, 243), // text
            RGB(160, 160, 160), // selection keys
            RGB(38, 74, 120),   // selected item
            RGB(255, 255, 255), // selected text
            RGB(106, 165, 239), // accent (MixZhuyin blue, lightened for dark)
            false,
        };
    }
    return ImeTheme{
        RGB(249, 249, 249), // background
        RGB(214, 214, 214), // border
        RGB(26, 26, 26),    // text
        RGB(112, 112, 112), // selection keys
        RGB(204, 224, 247), // selected item
        RGB(26, 26, 26),    // selected text
        RGB(27, 92, 171),   // accent (MixZhuyin blue)
        false,
    };
}

bool applyDwmFrame(HWND hwnd, const ImeTheme& theme) {
    if (!hwnd) {
        return false;
    }
    DWORD corner = kDwmCornerRound;
    if (FAILED(::DwmSetWindowAttribute(hwnd, kDwmWindowCornerPreference, &corner, sizeof(corner)))) {
        return false;
    }
    COLORREF border = theme.border;
    ::DwmSetWindowAttribute(hwnd, kDwmBorderColor, &border, sizeof(border));
    return true;
}

int scaleForDpi(HDC dc, int px) {
    int dpi = dc ? ::GetDeviceCaps(dc, LOGPIXELSY) : 96;
    if (dpi <= 0) {
        dpi = 96;
    }
    return ::MulDiv(px, dpi, 96);
}

} // namespace Ime
