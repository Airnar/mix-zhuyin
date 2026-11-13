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

#include "CandidateWindow.h"
#include "DrawUtils.h"
#include "TextService.h"
#include "EditSession.h"

#include <algorithm>
#include <cassert>

#include <tchar.h>
#include <windows.h>

using namespace std;

namespace Ime {

CandidateWindow::CandidateWindow(TextService* service, EditSession* session):
    ImeWindow(service),
    shown_(false),
    candPerRow_(1),
    textWidth_(0),
    itemWidth_(0),
    itemHeight_(0),
    padX_(8),
    padY_(3),
    keyGap_(6),
    radius_(4),
    currentSel_(0),
    hasResult_(false),
    useCursor_(true),
    selKeyWidth_(0) {

    // Spacing at 96 DPI; updateMetrics() scales it for the screen.
    margin_ = 4;
    rowSpacing_ = 2;
    colSpacing_ = 2;

    HWND parent = service->compositionWindow(session);
    create(parent, WS_POPUP|WS_CLIPCHILDREN, WS_EX_TOOLWINDOW|WS_EX_TOPMOST);
    initFrame();
}

CandidateWindow::~CandidateWindow(void) {
}

// ITfUIElement
STDMETHODIMP CandidateWindow::GetDescription(BSTR *pbstrDescription) {
    if (!pbstrDescription)
        return E_INVALIDARG;
    *pbstrDescription = SysAllocString(L"Candidate window~");
    return S_OK;
}

// {BD7CCC94-57CD-41D3-A789-AF47890CEB29}
STDMETHODIMP CandidateWindow::GetGUID(GUID *pguid) {
    if (!pguid)
        return E_INVALIDARG;
    *pguid = { 0xbd7ccc94, 0x57cd, 0x41d3, { 0xa7, 0x89, 0xaf, 0x47, 0x89, 0xc, 0xeb, 0x29 } };
    return S_OK;
}

STDMETHODIMP CandidateWindow::Show(BOOL bShow) {
    shown_ = bShow;
    if (shown_)
        show();
    else
        hide();
    return S_OK;
}

STDMETHODIMP CandidateWindow::IsShown(BOOL *pbShow) {
    if (!pbShow)
        return E_INVALIDARG;
    *pbShow = shown_;
    return S_OK;
}

// ITfCandidateListUIElement
STDMETHODIMP CandidateWindow::GetUpdatedFlags(DWORD *pdwFlags) {
    if (!pdwFlags)
        return E_INVALIDARG;
    /// XXX update all!!!
    *pdwFlags = TF_CLUIE_DOCUMENTMGR | TF_CLUIE_COUNT | TF_CLUIE_SELECTION | TF_CLUIE_STRING | TF_CLUIE_PAGEINDEX | TF_CLUIE_CURRENTPAGE;
    return S_OK;
}

STDMETHODIMP CandidateWindow::GetDocumentMgr(ITfDocumentMgr **ppdim) {
    if (!textService_)
        return E_FAIL;
    ITfContext* context = textService_->currentContext();
    if (!context)
        return E_FAIL;
    return context->GetDocumentMgr(ppdim);
}

STDMETHODIMP CandidateWindow::GetCount(UINT *puCount) {
    if (!puCount)
        return E_INVALIDARG;
    *puCount = std::min<UINT>(10, items_.size());
    return S_OK;
}

STDMETHODIMP CandidateWindow::GetSelection(UINT *puIndex) {
    assert(currentSel_ >= 0);
    if (!puIndex)
        return E_INVALIDARG;
    *puIndex = static_cast<UINT>(currentSel_);
    return S_OK;
}

STDMETHODIMP CandidateWindow::GetString(UINT uIndex, BSTR *pbstr) {
    if (!pbstr)
        return E_INVALIDARG;
    if (uIndex >= items_.size())
        return E_INVALIDARG;
    *pbstr = SysAllocString(items_[uIndex].c_str());
    return S_OK;
}

STDMETHODIMP CandidateWindow::GetPageIndex(UINT *puIndex, UINT uSize, UINT *puPageCnt) {
    /// XXX Always return the same single page index.
    if (!puPageCnt)
        return E_INVALIDARG;
    *puPageCnt = 1;
    if (puIndex) {
        if (uSize < *puPageCnt) {
            return E_INVALIDARG;
        }
        puIndex[0] = 0;
    }
    return S_OK;
}

STDMETHODIMP CandidateWindow::SetPageIndex(UINT *puIndex, UINT uPageCnt) {
    /// XXX Do not let app set page indices.
    if (!puIndex)
        return E_INVALIDARG;
    return S_OK;
}

STDMETHODIMP CandidateWindow::GetCurrentPage(UINT *puPage) {
    if (!puPage)
        return E_INVALIDARG;
    *puPage = 0;
    return S_OK;
}

LRESULT CandidateWindow::wndProc(UINT msg, WPARAM wp , LPARAM lp) {
    switch (msg) {
        case WM_PAINT:
            onPaint(wp, lp);
            break;
        case WM_ERASEBKGND:
            return TRUE;
            break;
        case WM_LBUTTONDOWN:
            onLButtonDown(wp, lp);
            break;
        case WM_MOUSEMOVE:
            onMouseMove(wp, lp);
            break;
        case WM_LBUTTONUP:
            onLButtonUp(wp, lp);
            break;
        case WM_MOUSEACTIVATE:
            return MA_NOACTIVATE;
        default:
            return Window::wndProc(msg, wp, lp);
    }
    return 0;
}

void CandidateWindow::onPaint(WPARAM wp, LPARAM lp) {
    PAINTSTRUCT ps;
    BeginPaint(hwnd_, &ps);
    RECT rc;
    GetClientRect(hwnd_, &rc);
    int width = rc.right - rc.left;
    int height = rc.bottom - rc.top;
    if (width <= 0 || height <= 0) {
        EndPaint(hwnd_, &ps);
        return;
    }

    // Draw into a memory bitmap first so moving the selection does not flicker.
    HDC hDC = ::CreateCompatibleDC(ps.hdc);
    HBITMAP bitmap = ::CreateCompatibleBitmap(ps.hdc, width, height);
    HGDIOBJ oldBitmap = ::SelectObject(hDC, bitmap);
    HGDIOBJ oldFont = ::SelectObject(hDC, font_);

    ImeTheme theme = currentImeTheme();
    paintFrame(hDC, rc, theme);
    ::SetBkMode(hDC, TRANSPARENT);
    for (int i = 0, n = items_.size(); i < n; ++i) {
        paintItem(hDC, theme, i);
    }

    ::BitBlt(ps.hdc, 0, 0, width, height, hDC, 0, 0, SRCCOPY);
    ::SelectObject(hDC, oldFont);
    ::SelectObject(hDC, oldBitmap);
    ::DeleteObject(bitmap);
    ::DeleteDC(hDC);
    EndPaint(hwnd_, &ps);
}

void CandidateWindow::updateMetrics(HDC hDC) {
    // 96-DPI values, scaled for the screen the window is on.
    int scale = isImmersive() ? 2 : 1;
    margin_ = scaleForDpi(hDC, 4 * scale);
    rowSpacing_ = scaleForDpi(hDC, 2 * scale);
    colSpacing_ = scaleForDpi(hDC, 2 * scale);
    padX_ = scaleForDpi(hDC, 8 * scale);
    padY_ = scaleForDpi(hDC, 3 * scale);
    keyGap_ = scaleForDpi(hDC, 6 * scale);
    radius_ = scaleForDpi(hDC, 4);
}

void CandidateWindow::recalculateSize() {
    if(items_.empty()) {
        resize(0, 0);
        return;
    }

    HDC hDC = ::GetWindowDC(hwnd());
    updateMetrics(hDC);
    selKeyWidth_ = 0;
    textWidth_ = 0;
    int textHeight = 0;

    HGDIOBJ oldFont = ::SelectObject(hDC, font_);
    for(int i = 0, n = items_.size(); i < n; ++i) {
        // the selection key
        SIZE selKeySize = {0};
        wchar_t selKey = i < (int)selKeys_.size() ? selKeys_[i] : L' ';
        ::GetTextExtentPoint32W(hDC, &selKey, 1, &selKeySize);
        if(selKeySize.cx > selKeyWidth_)
            selKeyWidth_ = selKeySize.cx;

        // the candidate string
        SIZE candidateSize = {0};
        wstring& item = items_.at(i);
        ::GetTextExtentPoint32W(hDC, item.c_str(), item.length(), &candidateSize);
        if(candidateSize.cx > textWidth_)
            textWidth_ = candidateSize.cx;
        textHeight = max(textHeight, (int)max(candidateSize.cy, selKeySize.cy));
    }
    ::SelectObject(hDC, oldFont);
    ::ReleaseDC(hwnd(), hDC);

    itemWidth_ = padX_ + selKeyWidth_ + keyGap_ + textWidth_ + padX_;
    itemHeight_ = padY_ + textHeight + padY_;

    int perRow = candPerRow_ > 0 ? candPerRow_ : 1;
    int columns = min((int)items_.size(), perRow);
    int rows = ((int)items_.size() + perRow - 1) / perRow;
    int width = margin_ * 2 + columns * itemWidth_ + (columns - 1) * colSpacing_;
    int height = margin_ * 2 + rows * itemHeight_ + (rows - 1) * rowSpacing_;
    resize(width, height);
}

void CandidateWindow::setCandPerRow(int n) {
    if(n != candPerRow_) {
        candPerRow_ = n;
        recalculateSize();
    }
}

bool CandidateWindow::filterKeyEvent(KeyEvent& keyEvent) {
    // select item with arrow keys
    int oldSel = currentSel_;
    switch(keyEvent.keyCode()) {
    case VK_UP:
        if(currentSel_ - candPerRow_ >=0)
            currentSel_ -= candPerRow_;
        break;
    case VK_DOWN:
        if(currentSel_ + candPerRow_ < items_.size())
            currentSel_ += candPerRow_;
        break;
    case VK_LEFT:
        if(currentSel_ - 1 >=0)
            --currentSel_;
        break;
    case VK_RIGHT:
        if(currentSel_ + 1 < items_.size())
            ++currentSel_;
        break;
    case VK_RETURN:
        hasResult_ = true;
        return true;
    default:
        return false;
    }
    // if currently selected item is changed, redraw
    if(currentSel_ != oldSel) {
        // repaint the old and new items
        RECT rect;
        itemRect(oldSel, rect);
        ::InvalidateRect(hwnd_, &rect, TRUE);
        itemRect(currentSel_, rect);
        ::InvalidateRect(hwnd_, &rect, TRUE);
        return true;
    }
    return false;
}

void CandidateWindow::setCurrentSel(int sel) {
    if(sel >= items_.size())
        sel = 0;
    if (currentSel_ != sel) {
        currentSel_ = sel;
        if (isVisible())
            ::InvalidateRect(hwnd_, NULL, TRUE);
    }
}

void CandidateWindow::clear() {
    items_.clear();
    selKeys_.clear();
    currentSel_ = 0;
    hasResult_ = false;
}

void CandidateWindow::setUseCursor(bool use) {
    useCursor_ = use;
    if(isVisible())
        ::InvalidateRect(hwnd_, NULL, TRUE);
}

void CandidateWindow::paintItem(HDC hDC, const ImeTheme& theme, int i) {
    RECT rect;
    itemRect(i, rect);
    bool selected = useCursor_ && i == currentSel_;

    if (selected) {
        // A rounded highlight with an accent bar on its left edge.
        HBRUSH brush = ::CreateSolidBrush(theme.selectionBackground);
        HPEN pen = ::CreatePen(PS_SOLID, 1, theme.selectionBackground);
        HGDIOBJ oldBrush = ::SelectObject(hDC, brush);
        HGDIOBJ oldPen = ::SelectObject(hDC, pen);
        ::RoundRect(hDC, rect.left, rect.top, rect.right, rect.bottom, radius_ * 2, radius_ * 2);
        ::SelectObject(hDC, oldPen);
        ::SelectObject(hDC, oldBrush);
        ::DeleteObject(pen);
        ::DeleteObject(brush);

        if (!theme.highContrast) {
            int barWidth = max(2, radius_ * 3 / 4);
            int barHeight = (rect.bottom - rect.top) / 2;
            int barTop = rect.top + ((rect.bottom - rect.top) - barHeight) / 2;
            HBRUSH accent = ::CreateSolidBrush(theme.accent);
            HPEN accentPen = ::CreatePen(PS_SOLID, 1, theme.accent);
            oldBrush = ::SelectObject(hDC, accent);
            oldPen = ::SelectObject(hDC, accentPen);
            ::RoundRect(hDC, rect.left, barTop, rect.left + barWidth, barTop + barHeight, barWidth, barWidth);
            ::SelectObject(hDC, oldPen);
            ::SelectObject(hDC, oldBrush);
            ::DeleteObject(accentPen);
            ::DeleteObject(accent);
        }
    }

    // the selection key, right-aligned so keys of different widths line up
    RECT keyRect = {rect.left + padX_, rect.top, rect.left + padX_ + selKeyWidth_, rect.bottom};
    wchar_t selKey = i < (int)selKeys_.size() ? selKeys_[i] : L' ';
    COLORREF keyColor = theme.selKey;
    if (selected) {
        keyColor = theme.highContrast ? theme.selectionText : theme.accent;
    }
    ::SetTextColor(hDC, keyColor);
    ::DrawTextW(hDC, &selKey, 1, &keyRect, DT_SINGLELINE | DT_VCENTER | DT_RIGHT | DT_NOPREFIX);

    // the candidate string
    wstring& item = items_.at(i);
    RECT textRect = {keyRect.right + keyGap_, rect.top, rect.right - padX_, rect.bottom};
    ::SetTextColor(hDC, selected ? theme.selectionText : theme.text);
    ::DrawTextW(hDC, item.c_str(), item.length(), &textRect, DT_SINGLELINE | DT_VCENTER | DT_LEFT | DT_NOPREFIX);
}

void CandidateWindow::itemRect(int i, RECT& rect) {
    int perRow = candPerRow_ > 0 ? candPerRow_ : 1;
    int row = i / perRow;
    int col = i % perRow;
    rect.left = margin_ + col * (itemWidth_ + colSpacing_);
    rect.top = margin_ + row * (itemHeight_ + rowSpacing_);
    rect.right = rect.left + itemWidth_;
    rect.bottom = rect.top + itemHeight_;
}


} // namespace Ime
