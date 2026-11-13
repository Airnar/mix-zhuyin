import {
  candidateUi,
  kCandidateFonts,
  kDefaultCandidateFont,
} from "./pime_ui";

describe("candidateUi", () => {
  test("defaults to a vertical list in Microsoft JhengHei UI", () => {
    expect(candidateUi({})).toEqual({
      candPerRow: 1,
      candFontSize: 16,
      candFontName: "Microsoft JhengHei UI",
      candUseCursor: true,
    });
    expect(kDefaultCandidateFont).toBe("Microsoft JhengHei UI");
  });

  test("clamps the font size", () => {
    expect(candidateUi({ candidate_font_size: 4 }).candFontSize).toBe(10);
    expect(candidateUi({ candidate_font_size: 99 }).candFontSize).toBe(32);
    expect(candidateUi({ candidate_font_size: 20 }).candFontSize).toBe(20);
  });

  test("uses the chosen font and falls back on bad names", () => {
    expect(candidateUi({ candidate_font_name: "DFKai-SB" }).candFontName).toBe(
      "DFKai-SB",
    );
    expect(candidateUi({ candidate_font_name: "" }).candFontName).toBe(
      kDefaultCandidateFont,
    );
    // Windows font face names are at most 31 characters.
    expect(
      candidateUi({ candidate_font_name: "x".repeat(32) }).candFontName,
    ).toBe(kDefaultCandidateFont);
  });

  test("lays candidates out in one row when horizontal", () => {
    expect(
      candidateUi({ candidate_layout: "horizontal", candidate_keys_count: 6 })
        .candPerRow,
    ).toBe(6);
    expect(candidateUi({ candidate_layout: "horizontal" }).candPerRow).toBe(9);
    expect(candidateUi({ candidate_layout: "vertical" }).candPerRow).toBe(1);
  });

  test("offers the default font first", () => {
    expect(kCandidateFonts[0].name).toBe(kDefaultCandidateFont);
    for (const font of kCandidateFonts) {
      expect(font.label.length).toBeGreaterThan(0);
    }
  });
});
