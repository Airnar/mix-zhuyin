/**
 * @license
 * Copyright (c) 2022 and onwards The McBopomofo Authors.
 * This code is released under the MIT license.
 * SPDX-License-Identifier: MIT
 * The main entrance of the IME for ChromeOS.
 */

import child_process from "child_process";
import fs from "fs";
import { List } from "lodash";
import path from "path";
import process from "process";

import { InputController } from "./McBopomofo/InputController";
import { Empty, Inputting, NotEmpty } from "./McBopomofo/InputState";
import { InputUI } from "./McBopomofo/InputUI";
import {
  AiAssistant,
  AiResponse,
  AiSettings,
  AiTask,
  askModel,
  FetchLike,
  kCloudProviders,
  kDefaultAiBaseUrl,
  kDefaultAiModel,
} from "./pime_ai";
import { openWithShell } from "./pime_config_tool";
import {
  messageBoxScript,
  openFileDialogScript,
  runPowerShell,
} from "./pime_dialogs";
import { KeyFromKeyboardEvent, VK_Keys } from "./pime_keys";

const ChineseConvert = require("chinese_convert");
import {
  DoubleCtrlDetector,
  LookupDictionary,
  lookupMessage,
} from "./pime_lookup";
import { legacyUserDataDir, migrateUserData, userDataDir } from "./pime_paths";
import { importPhraseFile, importSummary } from "./pime_phrase_import";
import { unprotectSecret } from "./pime_secrets";
import { defaultSettings, Settings } from "./pime_settings";
import { kSnippetsTemplate, parseSnippets } from "./pime_snippets";
import { candidateUi, compositionHighlight } from "./pime_ui";


/**
 * A middle data structure between McBopomofo input controller and PIME.
 * @interface
 */
interface UiState {
  /** The string to be committed. */
  commitString: string;
  /** The composition string. */
  compositionString: string;
  /** The cursor position in the composition string. */
  compositionCursor: number;
  /** Whether to show the candidate window. */
  showCandidates: boolean;
  /** The list of candidates. */
  candidateList: List<string>;
  /** The cursor position in the candidate list. */
  candidateCursor: number;
  /** The message to be shown. */
  showMessage: any;
  /** Whether to hide the message. */
  hideMessage: boolean;
  /**
   * The part of the composition to draw as the target, `[start, end)` in
   * code points: what the candidate window replaces.
   */
  compositionHighlight?: number[];
}


/**
 * The commands for PIME McBopomofo.
 * @enum
 */
enum PimeMcBopomofoCommand {
  Separator = 0,
  ModeIcon = 1,
  SwitchLanguage = 2,
  OpenHomepage = 3,
  OpenBugReport = 4,
  OpenOptions = 5,
  EditUserPhrase = 6,
  OpenUserPhrase = 7,
  OpenExcludedPhrase = 8,
  ToggleChineseConversion = 9,
  ToggleHalfWidthPunctuation = 10,
  Help = 11,
  OpenMcBopomofoUserDataFolder = 12,
  ReloadUserPhrase = 13,
  ToggleBpmfFontAnnotationSupport = 14,
  EditSnippets = 15,
  ImportMicrosoftPhrases = 16,
}

/** Wraps InputController and required states.  */
class PimeMcBopomofo {
  /** The input controller. */
  readonly inputController: InputController;
  /** The UI state. */
  uiState: UiState = {
    commitString: "",
    compositionString: "",
    compositionCursor: 0,
    showCandidates: false,
    candidateList: [],
    candidateCursor: 0,
    showMessage: {},
    hideMessage: true,
  };
  /** The settings in memory. */
  settings: Settings = defaultSettings;
  /**
   * Whether the input method is in Alphabet mode or Chinese mode. True for
   * Alphabet mode, false for Chinese mode.
   */
  isAlphabetMode: boolean = false;
  /** The last request from PIME. */
  lastRequest: any = {};
  /** Spots Ctrl tapped twice, for 框選查詢. */
  readonly ctrlTaps = new DoubleCtrlDetector();

  /**
   * Where the model for an AI feature is: the local one, or the user's cloud
   * service, as the settings say. Undefined while AI is off.
   */
  public aiSettingsFor(task: AiTask): AiSettings | undefined {
    const s = this.settings;
    if (!s.ai_enabled) {
      return undefined;
    }
    const source =
      task === "correct"
        ? s.ai_correct_source
        : task === "explain"
          ? s.ai_explain_source
          : s.ai_rewrite_source;
    if (source === "cloud") {
      const provider =
        kCloudProviders[s.ai_cloud_provider] ?? kCloudProviders.custom;
      return {
        protocol: provider.protocol,
        baseUrl: s.ai_cloud_base_url || provider.baseUrl,
        model: s.ai_cloud_model || provider.model,
        apiKey: "",
        isLocal: false,
        workspaceId: s.ai_cloud_workspace || undefined,
      };
    }
    return {
      protocol: "openai",
      baseUrl: s.ai_base_url || kDefaultAiBaseUrl,
      model: s.ai_model || kDefaultAiModel,
      apiKey: s.ai_api_key || "",
      isLocal: true,
    };
  }

  // The decrypted cloud key, kept while the encrypted one stays the same.
  private cloudKey_: { sealed: string; key: Promise<string> } | undefined;

  /** The cloud API key, decrypted with DPAPI on first use. */
  private cloudKey(): Promise<string> {
    const sealed = this.settings.ai_cloud_key_dpapi || "";
    if (!sealed) {
      return Promise.reject(new Error("還沒設定 API 金鑰"));
    }
    if (!this.cloudKey_ || this.cloudKey_.sealed !== sealed) {
      const key = unprotectSecret(sealed);
      key.catch(() => {
        this.cloudKey_ = undefined;
      });
      this.cloudKey_ = { sealed, key };
    }
    return this.cloudKey_.key;
  }

  /** The AI keys (off unless the user turns them on). */
  readonly ai = new AiAssistant({
    settingsFor: (task) => this.aiSettingsFor(task),
    composing: () => this.inputController.mixedSnapshot(),
    showSuggestions: (sentences) => {
      this.resetBeforeHandlingKey();
      return this.inputController.showAiCandidates(sentences);
    },
    chat: async (settings, messages) => {
      const apiKey = settings.isLocal ? settings.apiKey : await this.cloudKey();
      const answer = await askModel(
        { ...settings, apiKey },
        messages,
        fetch as unknown as FetchLike,
      );
      // Small local models often answer in Simplified Chinese.
      return this.settings.chineseConversion
        ? answer
        : ChineseConvert.cn2tw(answer);
    },
  });
  /** What onKeyDown answers for a key the AI took in filterKeyDown. */
  pendingAiResponse: AiResponse | undefined = undefined;
  // Loaded on the first lookup; null if there is no dictionary file.
  private lookupDictionary_: LookupDictionary | null | undefined = undefined;

  /** The 框選查詢 dictionary next to index.js (CC-CEDICT), if present. */
  private get lookupDictionary(): LookupDictionary | null {
    if (this.lookupDictionary_ === undefined) {
      this.lookupDictionary_ =
        LookupDictionary.load(path.join(__dirname, "lookup_dict.json")) ??
        null;
    }
    return this.lookupDictionary_;
  }

  /**
   * The lookup popup for text selected in the app (框選查詢), or undefined.
   * @param selection The selected text the text service sent.
   */
  public lookupResponse(selection: unknown): object | undefined {
    if (typeof selection !== "string") {
      return undefined;
    }
    let message = lookupMessage(selection, {
      readingOf: (text) => this.inputController.readingOf(text),
      translate: (text) => this.lookupDictionary?.translate(text),
    });
    if (!message) {
      return undefined;
    }
    const hint = this.ai.rememberLookup(selection.trim(), Date.now());
    if (hint) {
      message += "\n" + hint;
    }
    return { showLookup: { message, duration: hint ? 15 : 8 } };
  }
  /** Whether the last key down event was handled. */
  isLastFilterKeyDownHandled: boolean = false;
  /** Whether the input method is opened. */
  isOpened: boolean = true;
  /**
   * Helps to remember if Shift key is pressed on when key down event is
   * triggered. It would be reset on key on.
   */
  isShiftHold: boolean = false;
  /**
   * The single Shift tap started while composing in mixed mode, so it flips a
   * segment instead of toggling the alphabet mode.
   */
  isMixedShiftHold: boolean = false;
  /**
   * Helps to remember if Caps Lock is on when key down event is triggered. It
   * would be reset on key on.
   */
  isCapsLockHold: boolean = false;

  constructor() {
    this.inputController = new InputController(this.makeUI(this));
    this.inputController.setUserVerticalCandidates(true);
    this.inputController.setOnOpenUrl((url: string) => {
      const command = `start "" "${url}"`;
      child_process.exec(command);
    });
    this.inputController.setOnPhraseChange((map: Map<string, string[]>) => {
      this.writeUserPhrases(map);
    });
    this.inputController.setOnExcludedPhraseChange(
      (map: Map<string, string[]>) => {
        this.writeExcludedPhrases(map);
      },
    );
    this.inputController.setOnError(() => {
      if (this.settings.beep_on_error) {
        child_process.exec(`rundll32 user32.dll,MessageBeep`);
      }
    });
    // Apply the defaults right away: settings load asynchronously, and on a
    // fresh install there is no settings file to load at all.
    this.applySettings();
    this.loadSettings(() => {
      this.isOpened = !this.settings.by_default_deactivated;
    });

    this.loadUserPhrases();
    this.loadSnippets();
    this.loadMixedLearning();
  }

  /** Resets the UI state before handling a key. */
  public resetBeforeHandlingKey(): void {
    this.isLastFilterKeyDownHandled = false;
    this.uiState = {
      commitString: "",
      compositionString: "",
      compositionCursor: 0,
      showCandidates: false,
      candidateList: [],
      candidateCursor: 0,
      showMessage: {},
      hideMessage: true,
    };
  }

  /** Resets the input controller. */
  public resetController(): void {
    this.inputController.reset();
  }

  /**
   * The path to the user data folder, `%APPDATA%\MixZhuyin`. The all-in-one
   * build is its own product, so it no longer shares PIME's folder.
   */
  readonly mcBopomofoUserDataPath: string = userDataDir(process.env);

  /** The path to the user phrases file. */
  readonly userPhrasesPath: string = path.join(
    this.mcBopomofoUserDataPath,
    "data.txt",
  );

  /** The path to the excluded phrases file. */
  readonly excludedPhrasesPath: string = path.join(
    this.mcBopomofoUserDataPath,
    "exclude-phrases.txt",
  );

  /** The path to the text snippets file (快捷文字本). */
  readonly snippetsPath: string = path.join(
    this.mcBopomofoUserDataPath,
    "snippets.txt",
  );

  /** Loads the text snippets. */
  public loadSnippets(): void {
    fs.readFile(this.snippetsPath, (err, data) => {
      this.inputController.setSnippets(
        err ? [] : parseSnippets(data.toString("utf8")),
      );
    });
  }

  /**
   * Asks for a file exported from Microsoft Bopomofo and adds its phrases to
   * the user phrases, then says what it did.
   */
  public importMicrosoftPhrases(): void {
    runPowerShell(
      openFileDialogScript(
        "匯入微軟注音的使用者詞彙",
        "微軟注音詞彙檔 (*.txt;*.dat;*.lex)|*.txt;*.dat;*.lex|所有檔案 (*.*)|*.*",
      ),
    )
      .then((file) => {
        if (!file) {
          return undefined;
        }
        let message: string;
        try {
          const result = importPhraseFile(file, this.userPhrasesPath, (p) =>
            this.inputController.readingOf(p),
          );
          if (result.added > 0) {
            this.loadUserPhrases();
          }
          message = importSummary(result);
        } catch (e) {
          message = "無法讀取這個檔案：" + e;
        }
        return runPowerShell(messageBoxScript("混打注音", message));
      })
      .catch((e) => console.error(e));
  }

  /** The path to the user settings file. */
  readonly userSettingsPath: string = path.join(
    this.mcBopomofoUserDataPath,
    "config.json",
  );

  /** Loads user phrases from disk. */
  public loadUserPhrases(): void {
    fs.readFile(this.userPhrasesPath, (err, data) => {
      if (err) {
        console.error(
          "Unable to read user phrases from " + this.userPhrasesPath,
        );
        return;
      }
      try {
        const string = data.toString("utf8");
        this.inputController.setUserPhrases(string);
      } catch {
        console.error("Failed to parse user phrases");
      }
    });

    fs.readFile(this.excludedPhrasesPath, (err, data) => {
      if (err) {
        console.error(
          "Unable to read excluded phrases from " + this.excludedPhrasesPath,
        );
        return;
      }
      try {
        const string = data.toString("utf8");
        this.inputController.setExcludedPhrases(string);
      } catch {
        console.error("Failed to parse user phrases");
      }
    });
  }

  private writeUserPhrases(map: Map<string, string[]>): void {
    if (!fs.existsSync(this.mcBopomofoUserDataPath)) {
      console.log(
        "User data folder not found, creating " + this.mcBopomofoUserDataPath,
      );
      console.log("Creating one");
      fs.mkdirSync(this.mcBopomofoUserDataPath);
    }

    let string = "";
    for (const key of map.keys()) {
      const phrases = map.get(key);
      if (phrases === undefined) {
        continue;
      }
      for (const phrase of phrases) {
        string += phrase + " " + key + "\n";
      }
    }

    console.log("Writing user phrases to " + this.userPhrasesPath);
    fs.writeFile(this.userPhrasesPath, string, (err) => {
      if (err) {
        console.error("Failed to write user phrases");
        console.error(err);
      }
    });
  }

  private writeExcludedPhrases(map: Map<string, string[]>): void {
    if (!fs.existsSync(this.mcBopomofoUserDataPath)) {
      console.log(
        "User data folder not found, creating " + this.mcBopomofoUserDataPath,
      );
      console.log("Creating one");
      fs.mkdirSync(this.mcBopomofoUserDataPath);
    }

    let string = "";
    for (const key of map.keys()) {
      const phrases = map.get(key);
      if (phrases === undefined) {
        continue;
      }
      for (const phrase of phrases) {
        string += phrase + " " + key + "\n";
      }
    }

    console.log("Writing user phrases to " + this.userPhrasesPath);
    fs.writeFile(this.excludedPhrasesPath, string, (err) => {
      if (err) {
        console.error("Failed to write user phrases");
        console.error(err);
      }
    });
  }

  /** Toggles the alphabet mode. */
  public toggleAlphabetMode(): void {
    // Changes the alphabet mode, also commits current composing buffer.
    this.isAlphabetMode = !this.isAlphabetMode;
    this.resetController();
  }

  /** Applies the settings to the input controller. */
  public applySettings(): void {
    const useTraditionalMode = this.settings.input_mode === "use_plainbopomofo";
    this.inputController.setTraditionalMode(useTraditionalMode);
    this.inputController.setKeyboardLayout(this.settings.layout);
    this.inputController.setSelectPhrase(this.settings.select_phrase);
    this.inputController.setCandidateKeys(this.settings.candidate_keys);
    // Up and Down move through a vertical candidate window, Left and Right
    // through a horizontal one.
    this.inputController.setUserVerticalCandidates(
      this.settings.candidate_layout !== "horizontal",
    );
    this.inputController.setCandidateKeysCount(
      this.settings.candidate_keys_count,
    );
    this.inputController.setChineseConversionEnabled(
      this.settings.chineseConversion,
    );
    this.inputController.setEscClearEntireBuffer(
      this.settings.esc_key_clear_entire_buffer,
    );
    this.inputController.setMoveCursorAfterSelection(this.settings.move_cursor);
    this.inputController.setLetterMode(this.settings.letter_mode);
    this.inputController.setHalfWidthPunctuationEnabled(
      this.settings.half_width_punctuation,
    );
    this.inputController.setCtrlEnterOption(this.settings.ctrl_enter_option);
    this.inputController.setMovingCursorOption(
      this.settings.moving_cursor_option,
    );
    this.inputController.setRepeatedPunctuationChooseCandidate(
      this.settings.repeated_punctuation_choose_candidate,
    );
    this.inputController.setBopomofoFontAnnotationSupportEnabled(
      this.settings.bopomofo_font_annotation_support_enabled,
    );
    this.inputController.setMixedMode(this.settings.mixed_mode !== false);
    this.inputController.setMixedAutoSpace(
      this.settings.mixed_auto_space !== false,
    );
    this.inputController.setMixedDropStrayKeys(
      this.settings.mixed_drop_stray_keys !== false,
    );
    this.inputController.setLanguageCode("zh-TW");
  }

  /** The path to what mixed mode has learned. */
  readonly mixedLearningPath: string = path.join(
    this.mcBopomofoUserDataPath,
    "mixed-learning.json",
  );

  private mixedLearningTimer_: ReturnType<typeof setTimeout> | undefined;

  /** Loads what mixed mode has learned. */
  public loadMixedLearning(): void {
    fs.readFile(this.mixedLearningPath, (err, data) => {
      if (err) {
        return;
      }
      this.inputController.importMixedLearning(data.toString("utf8"));
    });
  }

  /** Saves what mixed mode has learned, a moment after the last change. */
  public scheduleSaveMixedLearning(): void {
    if (this.mixedLearningTimer_) {
      clearTimeout(this.mixedLearningTimer_);
    }
    this.mixedLearningTimer_ = setTimeout(() => {
      if (!fs.existsSync(this.mcBopomofoUserDataPath)) {
        fs.mkdirSync(this.mcBopomofoUserDataPath, { recursive: true });
      }
      fs.writeFile(
        this.mixedLearningPath,
        this.inputController.exportMixedLearning(),
        (err) => {
          if (err) {
            console.error("Failed to save mixed learning: " + err);
          }
        },
      );
    }, 2000);
  }

  /**
   * Load settings from disk.
   * @param callback The callback function.
   */
  public loadSettings(callback: () => void): void {
    fs.readFile(this.userSettingsPath, (err, data) => {
      if (err) {
        console.log(
          "Unable to read user settings from " + this.userSettingsPath,
        );
        this.writeSettings();
        this.applySettings();
        callback();
        return;
      }
      console.log(data);
      try {
        console.log("Try to load settings");
        const newSettings = JSON.parse(data.toString());
        this.settings = Object.assign({}, defaultSettings, newSettings);
        console.log(
          "Loaded settings: " + JSON.stringify(this.settings, null, 2),
        );
        this.applySettings();
      } catch {
        console.error("Failed to parse settings");
        this.writeSettings();
        this.applySettings();
      }
      callback();
    });
  }

  /** Write settings to disk */
  public writeSettings() {
    if (!fs.existsSync(this.mcBopomofoUserDataPath)) {
      console.log(
        "User data folder not found, creating " + this.mcBopomofoUserDataPath,
      );
      console.log("Creating one");
      fs.mkdirSync(this.mcBopomofoUserDataPath);
    }

    console.log("Writing user settings to " + this.userSettingsPath);
    const string = JSON.stringify(this.settings, null, 2);
    fs.writeFile(this.userSettingsPath, string, (err) => {
      if (err) {
        console.error("Failed to write settings");
        console.error(err);
      }
    });
  }

  /**
   * Creates an InputUI object.
   * @param instance The PimeMcBopomofo instance.
   * @returns The InputUI object.
   */
  public makeUI(instance: PimeMcBopomofo): InputUI {
    const that: InputUI = {
      reset: () => {
        instance.uiState = {
          commitString: "",
          compositionString: "",
          compositionCursor: 0,
          showCandidates: false,
          candidateList: [],
          candidateCursor: 0,
          showMessage: {},
          hideMessage: true,
        };
      },
      commitString(text: string) {
        const joinedCommitString = instance.uiState.compositionString + text;
        instance.uiState = {
          commitString: joinedCommitString,
          compositionString: "",
          compositionCursor: 0,
          showCandidates: false,
          candidateList: [],
          candidateCursor: 0,
          showMessage: {},
          hideMessage: true,
        };
      },
      update(stateString: string) {
        const state = JSON.parse(stateString);
        const composingBuffer = state.composingBuffer;
        const candidates = state.candidates;
        let selectedIndex = 0;
        let index = 0;
        const candidateList = [];
        for (const candidate of state.candidates) {
          if (candidate.selected) {
            selectedIndex = index;
          }
          candidateList.push(candidate.candidate.displayedText);
          index++;
        }

        // Note: McBopomofo's composing buffer are composed by segments so
        // it allows an input method framework to draw underlines
        let compositionString = "";
        for (const item of composingBuffer) {
          compositionString += item.text;
        }

        const tooltip = state.tooltip;
        let showMessage = {};
        let hideMessage = true;
        if (tooltip) {
          showMessage = { message: tooltip, duration: 3 };
          hideMessage = false;
        }

        // Note: A quick fix for the cursor index when BPMF font support is
        // enabled.
        //
        // The cursor index now includes additional control characters, but PIME
        // does not count these characters. We use JavaScript's `for...of`
        // syntax, which correctly iterates over Unicode code points instead of
        // code units, to skip these control characters and recalculate the
        // cursor index for PIME.
        let reportedCursorIndex = state.cursorIndex;
        let subString = compositionString.substring(0, reportedCursorIndex);
        let exactCharacterCount = 0;
        for (let c of subString) {
          exactCharacterCount++;
        }

        const commitString = instance.uiState.commitString;
        instance.uiState = {
          commitString: commitString,
          compositionString: compositionString,
          compositionCursor: exactCharacterCount,
          showCandidates: candidates.length > 0,
          candidateList: candidateList,
          candidateCursor: selectedIndex,
          showMessage: showMessage,
          hideMessage: hideMessage,
        };
        const highlight = compositionHighlight(composingBuffer);
        if (highlight) {
          instance.uiState.compositionHighlight = highlight;
        }
      },
    };
    return that;
  }

  /** Whether the button has been added to the UI. */
  alreadyAddButton: boolean = false;
  /** Whether the OS is Windows 8 or above. */
  isWindows8Above: boolean = false;

  /**
   * Creates the button UI response.
   * @returns The button UI response.
   */
  public buttonUiResponse(): any {
    let windowsModeIcon = "close.ico";
    if (this.isOpened) {
      if (this.isAlphabetMode) {
        windowsModeIcon = "eng.ico";
      } else {
        if (this.settings.chineseConversion) {
          windowsModeIcon = "simC.ico";
        } else {
          windowsModeIcon = "traC.ico";
        }
      }
    }

    const windowsModeIconPath = path.join(__dirname, "icons", windowsModeIcon);
    const settingsIconPath = path.join(__dirname, "icons", "config.ico");
    const object: any = {};

    if (!this.alreadyAddButton) {
      const addButton: any[] = [];
      if (this.isWindows8Above) {
        addButton.push({
          id: "windows-mode-icon",
          icon: windowsModeIconPath,
          commandId: PimeMcBopomofoCommand.ModeIcon,
          tooltip: "中英文切換",
        });
      }

      addButton.push({
        id: "switch-lang",
        icon: windowsModeIconPath,
        commandId: PimeMcBopomofoCommand.SwitchLanguage,
        tooltip: "中英文切換",
      });
      addButton.push({
        id: "settings",
        icon: settingsIconPath,
        type: "menu",
        tooltip: "設定",
      });
      object.addButton = addButton;
    } else {
      const changeButton: any[] = [];
      if (this.isWindows8Above) {
        changeButton.push({
          icon: windowsModeIconPath,
          id: "windows-mode-icon",
        });
      }
      changeButton.push({ icon: windowsModeIconPath, id: "switch-lang" });
      object.changeButton = changeButton;
    }
    return object;
  }

  /**
   * Creates the custom UI response.
   * @returns The custom UI response.
   */
  public customUiResponse(): any {
    return {
      openKeyboard: this.isOpened,
      customizeUI: candidateUi(this.settings),
      setSelKeys: this.settings.candidate_keys,
      keyboardOpen: this.isOpened,
    };
  }

  /**
   * Opens a settings page with config_tool.js, run by the same Node.js as the
   * input method, so no Python is needed.
   * @param page "options", "user_phrases", "snippets" or "help".
   */
  public openConfigTool(page: string): void {
    const script = path.join(__dirname, "config_tool.js");
    console.log("Run " + script + " " + page);
    const child = child_process.spawn(process.execPath, [script, page], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", (e) => console.error(e));
    child.unref();
  }

  /** Creates the user phrases file if it does not exist. */
  public createUserPhrasesIfNotExists(): void {
    if (!fs.existsSync(pimeMcBopomofo.mcBopomofoUserDataPath)) {
      fs.mkdirSync(pimeMcBopomofo.mcBopomofoUserDataPath, { recursive: true });
    }

    const userPhrasesUrl = pimeMcBopomofo.userPhrasesPath;
    if (!fs.existsSync(userPhrasesUrl)) {
      fs.writeFileSync(
        userPhrasesUrl,
        "# 一個詞彙一行，格式為：\n# 詞彙 注音\n# 例如：\n# 小麥注音 ㄒㄧㄠˇ-ㄇㄞˋ-ㄓㄨˋ-ㄧㄣ\n",
      );
      console.log("Created empty user phrase file at " + userPhrasesUrl);
    }

    const excludedPhrasesUrl = pimeMcBopomofo.excludedPhrasesPath;
    if (!fs.existsSync(excludedPhrasesUrl)) {
      fs.writeFileSync(
        excludedPhrasesUrl,
        "# 一個詞彙一行，格式為：\n# 詞彙 注音\n# 例如：\n# 小麥注音 ㄒㄧㄠˇ-ㄇㄞˋ-ㄓㄨˋ-ㄧㄣ\n",
      );
      console.log("Created empty user phrase file at " + excludedPhrasesUrl);
    }

    if (!fs.existsSync(pimeMcBopomofo.snippetsPath)) {
      fs.writeFileSync(pimeMcBopomofo.snippetsPath, kSnippetsTemplate);
    }
  }

  /**
   * Handles a command.
   * @param id The command ID.
   */
  public handleCommand(id: PimeMcBopomofoCommand): void {
    switch (id) {
      case PimeMcBopomofoCommand.ModeIcon:
      case PimeMcBopomofoCommand.SwitchLanguage:
        {
          if (this.isOpened === false) {
            return;
          }
          this.toggleAlphabetMode();
        }
        break;
      case PimeMcBopomofoCommand.OpenHomepage:
        {
          const url = "https://github.com/Airnar/mix-zhuyin";
          const command = `start ${url}`;
          console.log("Run " + command);
          child_process.exec(command);
        }
        break;
      case PimeMcBopomofoCommand.OpenBugReport:
        {
          const url = "https://github.com/Airnar/mix-zhuyin/issues";
          const command = `start ${url}`;
          console.log("Run " + command);
          child_process.exec(command);
        }
        break;
      case PimeMcBopomofoCommand.OpenOptions:
        {
          this.createUserPhrasesIfNotExists();
          this.openConfigTool("options");
        }
        break;
      case PimeMcBopomofoCommand.EditUserPhrase:
        {
          this.createUserPhrasesIfNotExists();
          this.openConfigTool("user_phrases");
        }
        break;
      case PimeMcBopomofoCommand.EditSnippets:
        this.createUserPhrasesIfNotExists();
        this.openConfigTool("snippets");
        break;
      case PimeMcBopomofoCommand.ImportMicrosoftPhrases:
        this.createUserPhrasesIfNotExists();
        this.importMicrosoftPhrases();
        break;
      case PimeMcBopomofoCommand.OpenUserPhrase:
        {
          this.createUserPhrasesIfNotExists();
          openWithShell(pimeMcBopomofo.userPhrasesPath);
        }
        break;
      case PimeMcBopomofoCommand.OpenExcludedPhrase:
        {
          this.createUserPhrasesIfNotExists();
          openWithShell(pimeMcBopomofo.excludedPhrasesPath);
        }
        break;
      case PimeMcBopomofoCommand.ToggleChineseConversion:
        pimeMcBopomofo.settings.chineseConversion =
          !pimeMcBopomofo.settings.chineseConversion;
        pimeMcBopomofo.applySettings();
        pimeMcBopomofo.writeSettings();
        break;
      case PimeMcBopomofoCommand.ToggleHalfWidthPunctuation:
        pimeMcBopomofo.settings.half_width_punctuation =
          !pimeMcBopomofo.settings.half_width_punctuation;
        pimeMcBopomofo.applySettings();
        pimeMcBopomofo.writeSettings();
        break;
      case PimeMcBopomofoCommand.Help:
        {
          this.openConfigTool("help");
        }
        break;
      case PimeMcBopomofoCommand.OpenMcBopomofoUserDataFolder: {
        if (!fs.existsSync(pimeMcBopomofo.mcBopomofoUserDataPath)) {
          fs.mkdirSync(pimeMcBopomofo.mcBopomofoUserDataPath);
        }
        openWithShell(pimeMcBopomofo.mcBopomofoUserDataPath);
        break;
      }
      case PimeMcBopomofoCommand.ReloadUserPhrase:
        {
          pimeMcBopomofo.loadUserPhrases();
        }
        break;
      case PimeMcBopomofoCommand.ToggleBpmfFontAnnotationSupport: {
        let currentSetting =
          pimeMcBopomofo.settings.bopomofo_font_annotation_support_enabled;
        pimeMcBopomofo.settings.bopomofo_font_annotation_support_enabled =
          !currentSetting;
        pimeMcBopomofo.applySettings();
        pimeMcBopomofo.writeSettings();
      }
      default:
        break;
    }
  }
}

// The PIME add-on kept its data in %APPDATA%\PIME\mixzhuyin; bring settings,
// user phrases and learning along the first time the all-in-one build runs.
try {
  if (
    migrateUserData(legacyUserDataDir(process.env), userDataDir(process.env))
  ) {
    console.log("Copied user data from the PIME add-on");
  }
} catch (e) {
  console.error(e);
}

const pimeMcBopomofo = new PimeMcBopomofo();

/** Whether a Windows virtual-key code is Ctrl. */
const isCtrlKey = (keyCode: number): boolean =>
  keyCode === VK_Keys.VK_CONTROL ||
  keyCode === VK_Keys.VK_LCONTROL ||
  keyCode === VK_Keys.VK_RCONTROL;

try {
  pimeMcBopomofo.createUserPhrasesIfNotExists();

  if (!fs.existsSync(pimeMcBopomofo.userSettingsPath)) {
    fs.writeFileSync(
      pimeMcBopomofo.userSettingsPath,
      JSON.stringify(defaultSettings),
    );
  }

  fs.watch(pimeMcBopomofo.userSettingsPath, (event, filename) => {
    if (filename) {
      pimeMcBopomofo.loadSettings(() => {});
    }
  });

  fs.watch(pimeMcBopomofo.userPhrasesPath, (event, filename) => {
    if (filename) {
      pimeMcBopomofo.loadUserPhrases();
    }
  });

  fs.watch(pimeMcBopomofo.excludedPhrasesPath, (event, filename) => {
    if (filename) {
      pimeMcBopomofo.loadUserPhrases();
    }
  });

  fs.watch(pimeMcBopomofo.snippetsPath, (event, filename) => {
    if (filename) {
      pimeMcBopomofo.loadSnippets();
    }
  });
} catch (e) {
  console.error(e);
}

module.exports = {
  textReducer(_: any, preState: any) {
    // Note: textReducer and response are the pattern of NIME. Actually, PIME
    // only care about the response. Since we let pimeMcBopomofo to do
    // everything, we just left textReducer as an empty implementation to let
    // NIME to call it.
    return preState;
  },

  response(request: any, _: any) {
    const lastRequest = pimeMcBopomofo.lastRequest;
    pimeMcBopomofo.lastRequest = request;
    const responseTemplate = {
      return: false,
      success: true,
      seqNum: request.seqNum,
    };
    if (request.method === "init") {
      const { isWindows8Above } = request;
      pimeMcBopomofo.isWindows8Above = isWindows8Above;
      const response = Object.assign({}, responseTemplate);
      return response;
    }
    if (request.method === "close") {
      const response = Object.assign({}, responseTemplate, {});
      return response;
    }

    if (request.method === "onActivate") {
      const customUi = pimeMcBopomofo.customUiResponse();
      const buttonUi = pimeMcBopomofo.buttonUiResponse();
      pimeMcBopomofo.alreadyAddButton = true;
      const response = Object.assign({}, responseTemplate, customUi, buttonUi);
      return response;
    }

    if (request.method === "onDeactivate") {
      const response = Object.assign({}, responseTemplate, {
        removeButton: ["windows-mode-icon", "switch-lang", "settings"],
      });
      pimeMcBopomofo.alreadyAddButton = false;
      return response;
    }

    if (request.method === "onPreservedKey") {
      console.log(request);
      const response = Object.assign({}, responseTemplate);
      return response;
    }

    if (request.method === "filterKeyUp") {
      // 框選查詢: the text service sends the selected text with Ctrl key ups.
      if (
        pimeMcBopomofo.ctrlTaps.keyUp(isCtrlKey(request.keyCode), Date.now())
      ) {
        const lookup = pimeMcBopomofo.lookupResponse(request.selectionText);
        if (lookup) {
          return Object.assign({}, responseTemplate, lookup, { return: false });
        }
      }
      const state = pimeMcBopomofo.inputController.state;
      let handled = state instanceof Empty === false;
      if (
        lastRequest &&
        lastRequest.method === "filterKeyUp" &&
        lastRequest.keyCode === request.keyCode
      ) {
        // NOTE: Some app, like MS Word, may send repeated key up event.
        // We should ignore such events.
        const response = Object.assign({}, responseTemplate, {
          return: handled,
        });
        return response;
      }

      // Single Shift to toggle alphabet mode.
      let uiState = {
        commitString: "",
        compositionString: "",
        compositionCursor: 0,
        showCandidates: false,
        candidateList: [],
        candidateCursor: 0,
        showMessage: {},
        hideMessage: true,
      };

      if (pimeMcBopomofo.isShiftHold && pimeMcBopomofo.isMixedShiftHold) {
        // Claim the key up so PIME calls onKeyUp with an edit session: PIME
        // ignores composition changes in filter* responses. The flip itself
        // happens in onKeyUp, because TSF may filter the same key up twice.
        const response = Object.assign({}, responseTemplate, {
          return: true,
        });
        return response;
      }

      if (pimeMcBopomofo.isShiftHold) {
        pimeMcBopomofo.toggleAlphabetMode();
        // Note: Since we are toggling alphabet mode on key up event, we should
        // update the icons here.
        const customUi = pimeMcBopomofo.customUiResponse();
        const buttonUi = pimeMcBopomofo.buttonUiResponse();
        let response = Object.assign(
          {},
          responseTemplate,
          customUi,
          buttonUi,
          uiState,
          {
            return: false,
          },
        );
        // Note: We return false here so we can let the shift key event to be
        // passeds to IntelliJ and then IntelliJ can trigger the action menu by
        // the double shift key event.
        return response;
      }
      let response = Object.assign({}, responseTemplate, {
        return: handled,
      });
      return response;
    }

    if (request.method === "onKeyUp") {
      if (
        pimeMcBopomofo.isShiftHold &&
        pimeMcBopomofo.isMixedShiftHold &&
        request.keyCode === VK_Keys.VK_SHIFT
      ) {
        pimeMcBopomofo.isShiftHold = false;
        pimeMcBopomofo.isMixedShiftHold = false;
        pimeMcBopomofo.resetBeforeHandlingKey();
        pimeMcBopomofo.inputController.mixedShiftTap();
        const response = Object.assign(
          {},
          responseTemplate,
          pimeMcBopomofo.uiState,
          {
            return: true,
          },
        );
        return response;
      }
      if (pimeMcBopomofo.isShiftHold) {
        let response = Object.assign({}, responseTemplate, {
          return: false,
        });
        return response;
      }
    }

    if (request.method === "filterKeyDown") {
      pimeMcBopomofo.ctrlTaps.keyDown(isCtrlKey(request.keyCode), Date.now());
      if (
        lastRequest &&
        lastRequest.method === "filterKeyDown" &&
        lastRequest.keyCode === request.keyCode
      ) {
        // NOTE: Some app, like MS Word, may send repeated key down event.
        // We should ignore such events.
        const response = Object.assign({}, responseTemplate, {
          return: true,
        });
        return response;
      }

      const { keyCode, charCode, keyStates } = request;

      // AI keys: Ctrl+Enter while composing; Ctrl+E / Ctrl+R after a lookup;
      // Enter / Esc for a rewrite.
      const aiResponse = pimeMcBopomofo.ai.keyDown(
        {
          keyCode,
          ctrl: (keyStates[VK_Keys.VK_CONTROL] & 0x80) !== 0,
          shift: (keyStates[VK_Keys.VK_SHIFT] & 0x80) !== 0,
          alt: (keyStates[VK_Keys.VK_MENU] & 0x80) !== 0,
        },
        Date.now(),
      );
      if (aiResponse) {
        pimeMcBopomofo.isShiftHold = false;
        pimeMcBopomofo.pendingAiResponse = aiResponse;
        return Object.assign({}, responseTemplate, { return: true });
      }

      const key = KeyFromKeyboardEvent(
        keyCode,
        keyStates,
        String.fromCharCode(charCode),
        charCode,
      );

      // Handles special key combinations for toggling input settings:
      // - Ctrl + Shift + G: Toggles Chinese conversion mode (between
      //   traditional and simplified Chinese)
      // - Ctrl + Shift + H: Toggles half-width punctuation mode
      if (
        key.ctrlPressed &&
        key.shiftPressed &&
        (key.ascii === "G" || key.ascii === "H")
      ) {
        pimeMcBopomofo.isShiftHold = false;
        if (key.ascii === "G") {
          pimeMcBopomofo.settings.chineseConversion =
            !pimeMcBopomofo.settings.chineseConversion;
        } else if (key.ascii === "H") {
          pimeMcBopomofo.settings.half_width_punctuation =
            !pimeMcBopomofo.settings.half_width_punctuation;
        }
        pimeMcBopomofo.applySettings();
        pimeMcBopomofo.writeSettings();
        pimeMcBopomofo.resetController();
        pimeMcBopomofo.isLastFilterKeyDownHandled = true;

        const customUi = pimeMcBopomofo.customUiResponse();
        const buttonUi = pimeMcBopomofo.buttonUiResponse();

        const response = Object.assign(
          {},
          responseTemplate,
          customUi,
          buttonUi,
          {
            return: true,
          },
        );
        return response;
      }

      // Note: We only allow Shift key to toggle Alphabet/Chinese mode when the
      // state is Empty.
      let shouldHandleShift =
        pimeMcBopomofo.settings.shift_key_toggle_alphabet_mode === true;
      const state = pimeMcBopomofo.inputController.state;
      if (state instanceof Empty === false) {
        shouldHandleShift = false;
      }
      // In mixed mode, a Shift tap while composing flips the segment under
      // the cursor between Chinese and English.
      const isMixedComposing =
        pimeMcBopomofo.inputController.mixedMode && state instanceof Inputting;
      if (isMixedComposing) {
        shouldHandleShift = true;
      }

      const isPressingShiftOnly = key.ascii === "Shift";

      // Note: The way we detect if a user is trying to press a single Shift key
      // to toggle Alphabet/Chinese mode, is to check if there is any key other
      // than the Shift key is received before the key up event.
      //
      // We set isShiftHold to true here. It means the user is pressing Shift
      // key only. Then, if there is any other key coming, we will reset
      // isShiftHold. Finally, if isShiftHold is still true in the key up event,
      // we will toggle Alphabet/Chinese.
      if (shouldHandleShift && isPressingShiftOnly) {
        pimeMcBopomofo.isShiftHold = true;
        pimeMcBopomofo.isMixedShiftHold = isMixedComposing;
        const response = Object.assign({}, responseTemplate, {
          return: false,
        });
        return response;
      } else {
        pimeMcBopomofo.isShiftHold = false;
        pimeMcBopomofo.isMixedShiftHold = false;
      }

      pimeMcBopomofo.resetBeforeHandlingKey();

      if ((keyStates[VK_Keys.VK_CAPITAL] & 1) !== 0) {
        // Ignores caps lock.
        pimeMcBopomofo.resetController();
        pimeMcBopomofo.isCapsLockHold = true;
        pimeMcBopomofo.isLastFilterKeyDownHandled = false;
        const response = Object.assign({}, responseTemplate, {
          return: false,
        });
        return response;
      } else {
        pimeMcBopomofo.isCapsLockHold = false;
      }

      if (pimeMcBopomofo.isAlphabetMode) {
        const response = Object.assign({}, responseTemplate, { return: false });
        return response;
      }

      const handled = pimeMcBopomofo.inputController.mcbopomofoKeyEvent(key);
      pimeMcBopomofo.isLastFilterKeyDownHandled = handled;
      if (
        pimeMcBopomofo.inputController.mixedMode &&
        pimeMcBopomofo.uiState.commitString
      ) {
        pimeMcBopomofo.scheduleSaveMixedLearning();
      }
      const response = Object.assign({}, responseTemplate, {
        return: handled,
      });
      return response;
    }

    if (request.method === "onKeyDown") {
      const aiResponse = pimeMcBopomofo.pendingAiResponse;
      if (aiResponse) {
        pimeMcBopomofo.pendingAiResponse = undefined;
        return Object.assign(
          {},
          responseTemplate,
          aiResponse.withUiState ? pimeMcBopomofo.uiState : {},
          aiResponse.fields,
          { return: true },
        );
      }
      // Ignore caps lock.
      if (pimeMcBopomofo.isCapsLockHold) {
        pimeMcBopomofo.resetController();
        const response = Object.assign({}, responseTemplate, {
          return: false,
        });
        return response;
      }

      if (
        lastRequest &&
        lastRequest.method === "onKeyDown" &&
        lastRequest.keyCode === request.keyCode
      ) {
        // NOTE: Some app, like MS Word, may send repeated key up event.
        // We should ignore such events.
        const response = Object.assign({}, responseTemplate, {
          return: true,
        });
        return response;
      }
      const uiState: any = pimeMcBopomofo.uiState;
      let response = Object.assign({}, responseTemplate, uiState, {
        return: pimeMcBopomofo.isLastFilterKeyDownHandled,
      });
      return response;
    }

    // The text service asks again for answers that arrive after a key (AI).
    if (request.method === "onRefresh") {
      const refreshed = pimeMcBopomofo.ai.refresh(Date.now());
      return Object.assign(
        {},
        responseTemplate,
        refreshed.withUiState ? pimeMcBopomofo.uiState : {},
        refreshed.fields,
      );
    }

    if (request.method === "onKeyboardStatusChanged") {
      const { opened } = request;
      pimeMcBopomofo.isOpened = opened;
      pimeMcBopomofo.resetController();
      const customUi = pimeMcBopomofo.customUiResponse();
      const buttonUi = pimeMcBopomofo.buttonUiResponse();
      const response = Object.assign({}, responseTemplate, customUi, buttonUi);
      return response;
    }

    if (request.method === "onCompositionTerminated") {
      pimeMcBopomofo.resetController();
      const uiState = pimeMcBopomofo.uiState;
      const customUi = pimeMcBopomofo.customUiResponse();
      const buttonUi = pimeMcBopomofo.buttonUiResponse();
      const response = Object.assign(
        {},
        responseTemplate,
        uiState,
        customUi,
        buttonUi,
      );
      pimeMcBopomofo.resetBeforeHandlingKey();
      return response;
    }

    if (request.method === "onCommand") {
      const { id } = request;
      pimeMcBopomofo.handleCommand(id);
      const uiState = pimeMcBopomofo.uiState;
      const customUi = pimeMcBopomofo.customUiResponse();
      const buttonUi = pimeMcBopomofo.buttonUiResponse();
      const response = Object.assign(
        {},
        responseTemplate,
        uiState,
        customUi,
        buttonUi,
      );
      return response;
    }

    if (request.method === "onMenu") {
      const menu = [
        {
          text: "混打注音網站",
          id: PimeMcBopomofoCommand.OpenHomepage,
        },
        {
          text: "問題回報",
          id: PimeMcBopomofoCommand.OpenBugReport,
        },
        {
          text: "輔助說明",
          id: PimeMcBopomofoCommand.Help,
        },
        {},
        {
          text:
            "簡繁模式：" +
            (pimeMcBopomofo.settings.chineseConversion ? "簡體" : "繁體"),
          id: PimeMcBopomofoCommand.ToggleChineseConversion,
        },
        {
          text:
            "標點模式：" +
            (pimeMcBopomofo.settings.half_width_punctuation ? "半形" : "全形"),
          id: PimeMcBopomofoCommand.ToggleHalfWidthPunctuation,
        },
        {},
        {
          text: "偏好設定 (&O)",
          id: PimeMcBopomofoCommand.OpenOptions,
        },
        {
          text: "編輯使用者詞庫 (&U)",
          id: PimeMcBopomofoCommand.EditUserPhrase,
        },
        {
          text: "匯入微軟注音詞彙…",
          id: PimeMcBopomofoCommand.ImportMicrosoftPhrases,
        },
        {
          text: "編輯快捷文字本 (&S)",
          id: PimeMcBopomofoCommand.EditSnippets,
        },
        {
          text: "用編輯器打開使用者詞庫",
          id: PimeMcBopomofoCommand.OpenUserPhrase,
        },
        {
          text: "用編輯器打開排除的詞彙",
          id: PimeMcBopomofoCommand.OpenExcludedPhrase,
        },
        {
          text: "打開使用者資料夾",
          id: PimeMcBopomofoCommand.OpenMcBopomofoUserDataFolder,
        },
        {
          text: "打開注音字體支援",
          id: PimeMcBopomofoCommand.ToggleBpmfFontAnnotationSupport,
          checked:
            pimeMcBopomofo.settings.bopomofo_font_annotation_support_enabled,
        },
        {},
        {
          text: "混打注音 for PIME 0.2.0（基於小麥注音）",
        },
      ];
      const response = Object.assign({}, responseTemplate, { return: menu });
      return response;
    }

    return responseTemplate;
  },
};
