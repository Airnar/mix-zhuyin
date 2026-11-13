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

#ifndef IME_IME_THEME_H
#define IME_IME_THEME_H

#include <windows.h>

namespace Ime {

// Colors of the candidate and message windows. They follow the Windows
// "app mode" (light or dark) setting, and fall back to the system colors
// when High Contrast is on.
struct ImeTheme {
    COLORREF background;
    COLORREF border;
    COLORREF text;
    COLORREF selKey;
    COLORREF selectionBackground;
    COLORREF selectionText;
    COLORREF accent;
    bool highContrast;
};

// Reads the current Windows settings. Cheap enough to call on every paint,
// so a theme switch shows up the next time a window is drawn.
ImeTheme currentImeTheme();

// Asks DWM for Windows 11 rounded corners and a border in the theme's color.
// Returns false on older Windows, where the caller draws its own border.
bool applyDwmFrame(HWND hwnd, const ImeTheme& theme);

// Scales a length in 96-DPI pixels to the DPI of the device context.
int scaleForDpi(HDC dc, int px);

} // namespace Ime

#endif
