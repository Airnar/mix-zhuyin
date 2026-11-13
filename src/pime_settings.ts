/**
 * MixZhuyin's PIME settings and their defaults. Shared by the input method
 * (pime.ts) and the settings page server (pime_config_tool.ts), which must not
 * pull in the whole engine.
 */
import { kDefaultCandidateFont } from "./pime_ui";

/**
 * The MixZhuyin Settings.
 * @interface
 */
export interface Settings {
  input_mode: string;
  /** The font size of the candidate window. */
  candidate_font_size: number;
  /** The Windows font face name of the candidate window. */
  candidate_font_name: string;
  /**
   * The candidate window layout.
   * @remarks
   * Valid options: "vertical" and "horizontal".
   */
  candidate_layout: string;
  /**
   * The keyboard layout.
   * @remarks
   * Valid options: "Standard", "Hsu", "ETen", "ETen26", "IBM", "HanyuPinyin"
   */
  layout: string;
  /**
   * The selection phrase.
   * @remarks
   * Valid options: "before_cursor" and "after_cursor".
   */
  select_phrase: string;
  /** The candidate keys like "123456789", "asdfghjkl" and so on. */
  candidate_keys: string;
  /** The number of candidate keys. */
  candidate_keys_count: number;
  /** Whether ESC key clears all of the composing buffer. */
  esc_key_clear_entire_buffer: boolean;
  /** Whether to use jk key to move cursor. */
  moving_cursor_option: number;
  /** Whether Shift key toggles the BPMF/Alphabet mode. */
  shift_key_toggle_alphabet_mode: boolean;
  /** Whether Traditional/Simplified Chinese conversion is on. */
  chineseConversion: boolean;
  /**
   * Whether the input method moves the cursor to the place of the end of the
   * selected candidate.
   * @remarks
   * Only works when select_phrase is "after_cursor"
   */
  move_cursor: boolean;
  /** Inputs upper case or lower case letters when shift key is pressed. */
  letter_mode: string;
  /**
   * Whether input half width punctuation instead of default full width
   * punctuation.
   */
  half_width_punctuation: boolean;
  /** Whether the input method is deactivated on Windows 8 and above. */
  by_default_deactivated: boolean;
  /** Whether prompts sound alerts when a user inputs invalid keys. */
  beep_on_error: boolean;
  /** The behavior for handling Ctrl+ Enter key. */
  ctrl_enter_option: number;
  /** Whether to use repeated punctuation to choose candidate. */
  repeated_punctuation_choose_candidate: boolean;
  /** Whether BPMF font annotation support is enabled. */
  bopomofo_font_annotation_support_enabled: boolean;
  /** Whether mixed Chinese/English input (automatic detection) is on. */
  mixed_mode: boolean;
  /** Whether to put a space between Chinese and English in mixed mode. */
  mixed_auto_space: boolean;
}

/** The default settings, used when the settings file lacks a key. */
export const defaultSettings: Settings = {
  input_mode: "use_mcbopomofo",
  candidate_font_size: 16,
  candidate_font_name: kDefaultCandidateFont,
  candidate_layout: "vertical",
  layout: "standard",
  select_phrase: "before_cursor",
  candidate_keys: "123456789",
  candidate_keys_count: 9,
  esc_key_clear_entire_buffer: false,
  shift_key_toggle_alphabet_mode: true,
  chineseConversion: false,
  move_cursor: true,
  letter_mode: "upper",
  half_width_punctuation: false,
  by_default_deactivated: false,
  beep_on_error: true,
  ctrl_enter_option: 0,
  moving_cursor_option: 0, // MovingCursorOption.Disabled
  repeated_punctuation_choose_candidate: false,
  bopomofo_font_annotation_support_enabled: false,
  mixed_mode: true,
  mixed_auto_space: true,
};
