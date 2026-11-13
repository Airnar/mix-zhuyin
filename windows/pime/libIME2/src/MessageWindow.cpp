//
//    Copyright (C) 2013 - 2020 Hong Jen Yee (PCMan) <pcman.tw@gmail.com>
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
//    You should have received a copy of the GNU Library General Public
//    License along with this library; if not, write to the
//    Free Software Foundation, Inc., 51 Franklin St, Fifth Floor,
//    Boston, MA  02110-1301, USA.
//

#include "MessageWindow.h"
#include "TextService.h"
#include "DrawUtils.h"

namespace Ime {

MessageWindow::MessageWindow(TextService* service, EditSession* session):
    ImeWindow(service) {

    HWND parent = service->compositionWindow(session);
    create(parent, WS_POPUP|WS_CLIPCHILDREN, WS_EX_TOOLWINDOW|WS_EX_TOPMOST);
    initFrame();
}

MessageWindow::~MessageWindow(void) {
}

// virtual
void MessageWindow::recalculateSize() {
    SIZE size = {0};
    HDC dc = GetDC(hwnd_);
    HGDIOBJ old_font = SelectObject(dc, font_);
    GetTextExtentPointW(dc, text_.c_str(), text_.length(), &size);
    int padX = scaleForDpi(dc, 10);
    int padY = scaleForDpi(dc, 5);
    SelectObject(dc, old_font);
    ReleaseDC(hwnd_, dc);

    SetWindowPos(hwnd_, HWND_TOPMOST, 0, 0,
        size.cx + padX * 2, size.cy + padY * 2, SWP_NOACTIVATE|SWP_NOMOVE);
}

void MessageWindow::setText(std::wstring text) {
    // FIXMEl: use different appearance under immersive mode
    text_ = text;
    recalculateSize();
    if(IsWindowVisible(hwnd_))
        InvalidateRect(hwnd_, NULL, TRUE);
}

LRESULT MessageWindow::wndProc(UINT msg, WPARAM wp, LPARAM lp) {
    switch(msg) {
    case WM_PAINT: {
            PAINTSTRUCT ps;
            BeginPaint(hwnd_, &ps);
            onPaint(ps);
            EndPaint(hwnd_, &ps);
        }
        break;
    case WM_MOUSEACTIVATE:
        return MA_NOACTIVATE;
    default:
        return ImeWindow::wndProc(msg, wp, lp);
    }
    return 0;
}

void MessageWindow::onPaint(PAINTSTRUCT& ps) {
    int len = text_.length();
    RECT rc;
    GetClientRect(hwnd_, &rc);

    HDC hDC = ps.hdc;
    HFONT oldFont = (HFONT)SelectObject(hDC, font_);
    ImeTheme theme = currentImeTheme();
    paintFrame(hDC, rc, theme);

    SetBkMode(hDC, TRANSPARENT);
    SetTextColor(hDC, theme.text);
    DrawTextW(hDC, text_.c_str(), len, &rc, DT_SINGLELINE | DT_CENTER | DT_VCENTER | DT_NOPREFIX);

    SelectObject(hDC, oldFont);
}

} // namespace Ime
