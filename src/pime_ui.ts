/**
 * Candidate window settings for PIME.
 *
 * PIME draws the candidate window itself (white background, blue selection
 * keys); a backend can only choose the font, the size and how many candidates
 * go in a row.
 */

/** The candidate window font used unless the user picks another one. */
export const kDefaultCandidateFont = "Microsoft JhengHei UI";

/** Fonts offered in the settings page, by Windows font face name. */
export const kCandidateFonts: { name: string; label: string }[] = [
  { name: kDefaultCandidateFont, label: "微軟正黑體" },
  { name: "PMingLiU", label: "新細明體" },
  { name: "DFKai-SB", label: "標楷體" },
  { name: "Microsoft YaHei UI", label: "微軟雅黑體" },
];

/** The settings that shape the candidate window. */
export interface CandidateUiSettings {
  /** Font size in points; clamped to 10–32. */
  candidate_font_size?: number;
  /** Windows font face name. */
  candidate_font_name?: string;
  /** "vertical" (one candidate per row) or "horizontal" (one row). */
  candidate_layout?: string;
  /** How many candidates a page shows. */
  candidate_keys_count?: number;
}

/** The `customizeUI` object PIME understands. */
export interface CandidateUi {
  candPerRow: number;
  candFontSize: number;
  candFontName: string;
  candUseCursor: boolean;
}

// LOGFONT face names hold 31 characters plus the terminating null.
const kMaxFontNameLength = 31;

/**
 * Builds PIME's `customizeUI` object from the settings.
 * @param settings The user's settings.
 * @returns The candidate window font, size and layout.
 */
export const candidateUi = (settings: CandidateUiSettings): CandidateUi => {
  const size = settings.candidate_font_size ?? 16;
  const name = settings.candidate_font_name;
  const fontName =
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= kMaxFontNameLength
      ? name
      : kDefaultCandidateFont;
  const perPage = settings.candidate_keys_count ?? 9;
  return {
    candPerRow: settings.candidate_layout === "horizontal" ? perPage : 1,
    candFontSize: Math.min(32, Math.max(10, size)),
    candFontName: fontName,
    candUseCursor: true,
  };
};

/** A segment of the composing buffer, as InputController reports it. */
export interface ComposingSegmentText {
  text: string;
  style: string;
}

/**
 * Where the highlighted segment is in the composition: the part the
 * candidate window replaces, or a marked range. PIME counts the composition
 * cursor in code points, so this does too.
 * @param segments The composing buffer segments.
 * @returns `[start, end)` in code points, or undefined when nothing is
 * highlighted.
 */
export const compositionHighlight = (
  segments: ComposingSegmentText[],
): [number, number] | undefined => {
  let position = 0;
  for (const segment of segments) {
    const length = Array.from(segment.text).length;
    if (segment.style === "highlighted" && length > 0) {
      return [position, position + length];
    }
    position += length;
  }
  return undefined;
};
