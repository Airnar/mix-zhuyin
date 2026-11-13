window.onload = () => {
  const defaultSettings = {
    input_mode: "use_mcbopomofo",
    candidate_font_size: 16,
    candidate_font_name: "Microsoft JhengHei UI",
    candidate_layout: "vertical",
    layout: "standard",
    select_phrase: "before_cursor",
    candidate_keys: "123456789",
    candidate_keys_count: 9,
    esc_key_clear_entire_buffer: false,
    moving_cursor_option: 0,
    shift_key_toggle_alphabet_mode: true,
    half_width_punctuation: false,
    chinese_conversion: false,
    move_cursor: false,
    letter_mode: "upper",
    ctrl_enter_option: 0,
    by_default_deactivated: false,
    beep_on_error: true,
    repeated_punctuation_choose_candidate: false,
    allow_changing_prior_tone: false,
    mixed_mode: true,
    mixed_auto_space: true,
  };

  let settings = {};
  const $ = (id) => document.getElementById(id);

  // Sample candidates for ㄕˋ, shown in the candidate window preview.
  const previewCandidates = ["是", "事", "市", "試", "室", "世", "式", "視", "示"];

  function renderPreview() {
    const preview = $("cand_preview");
    const keys = $("keys").value;
    const count = +$("keys_count").value;
    const horizontal = $("layout_horizontal").checked;
    preview.style.fontFamily = `"${$("font_name").value}", sans-serif`;
    preview.style.fontSize = `${+$("font_size").value}pt`;
    preview.style.gridTemplateColumns = horizontal
      ? `repeat(${count}, auto)`
      : "auto";
    preview.textContent = "";
    previewCandidates.slice(0, count).forEach((candidate, index) => {
      const item = document.createElement("span");
      const key = document.createElement("b");
      key.textContent = keys[index];
      const text = document.createElement("i");
      text.textContent = candidate;
      if (index === 0) {
        item.className = "current";
      }
      item.append(key, text);
      preview.append(item);
    });
  }

  let statusTimer = undefined;
  function showStatus(message, isError) {
    const status = $("save_status");
    status.textContent = message;
    status.classList.toggle("error", isError);
    status.classList.add("visible");
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => status.classList.remove("visible"), 1600);
  }

  function applySettings(settings) {
    {
      if (settings.input_mode === "use_plainbopomofo") {
        $("use_plainbopomofo").checked = true;
      } else {
        $("use_mcbopomofo").checked = true;
      }
    }
    {
      const select = $("font_size");
      const options = select.getElementsByTagName("option");
      if (settings.candidate_font_size == undefined) {
        settings.candidate_font_size = 16;
      }
      for (const option of options) {
        if (+option.value === settings.candidate_font_size) {
          option.selected = "selected";
          break;
        }
      }
    }
    {
      const select = $("font_name");
      const name = settings.candidate_font_name || defaultSettings.candidate_font_name;
      if (![...select.options].some((option) => option.value === name)) {
        // A font set by hand in the settings file.
        select.add(new Option(name, name));
      }
      select.value = name;
    }
    {
      const horizontal = settings.candidate_layout === "horizontal";
      $("layout_horizontal").checked = horizontal;
      $("layout_vertical").checked = !horizontal;
    }
    {
      const select = $("layout");
      const options = select.getElementsByTagName("option");
      const layout = String(settings.layout || "Standard").toLowerCase();
      for (const option of options) {
        if (option.value.toLowerCase() === layout) {
          option.selected = "selected";
          break;
        }
      }
    }
    {
      const select = $("keys");
      const options = select.getElementsByTagName("option");
      for (const option of options) {
        if (option.value === settings.candidate_keys) {
          option.selected = "selected";
          break;
        }
      }
    }
    {
      const select = $("keys_count");
      const options = select.getElementsByTagName("option");
      for (const option of options) {
        if (option.value == settings.candidate_keys_count) {
          option.selected = "selected";
          break;
        }
      }
    }
    {
      if (settings.select_phrase === "before_cursor") {
        $("before_cursor").checked = true;
        $("after_cursor").checked = false;
      } else if (settings.select_phrase === "after_cursor") {
        $("before_cursor").checked = false;
        $("after_cursor").checked = true;
      }
    }
    {
      $("esc_key").checked = settings.esc_key_clear_entire_buffer;
    }
    {
      const enabled =
        settings.shift_key_toggle_alphabet_mode === undefined
          ? true
          : settings.shift_key_toggle_alphabet_mode;
      $("shift_key").checked = enabled;
    }
    {
      $("move_cursor").checked = settings.move_cursor;
    }
    {
      $("mixed_mode").checked =
        settings.mixed_mode === undefined ? true : settings.mixed_mode;
      $("mixed_auto_space").checked =
        settings.mixed_auto_space === undefined
          ? true
          : settings.mixed_auto_space;
    }

    {
      $("ctrl_enter_option").onchange = function (event) {
        const value = +$("ctrl_enter_option").value;
        settings.ctrl_enter_option = value;
        saveSettings(settings);
      };
    }

    {
      $("allow_change_prior_tone").checked = settings.allow_changing_prior_tone;
    }

    {
      $("repeated_punctuation_choose_candidate").checked =
        settings.repeated_punctuation_choose_candidate;
    }
    {
      const select = $("moving_cursor_option");
      const options = select.getElementsByTagName("option");
      for (const option of options) {
        if (option.value == settings.moving_cursor_option) {
          option.selected = "selected";
          break;
        }
      }
    }
    {
      if (settings.letter_mode === "upper") {
        $("uppercase_letters").checked = true;
        $("lowercase_letters").checked = false;
      } else if (settings.letter_mode === "lower") {
        $("uppercase_letters").checked = false;
        $("lowercase_letters").checked = true;
      }
    }

    {
      const select = $("ctrl_enter_option");
      const options = select.getElementsByTagName("option");
      for (const option of options) {
        if (option.value == settings.ctrl_enter_option) {
          option.selected = "selected";
          break;
        }
      }
    }

    {
      $("by_default_deactivated").checked = settings.by_default_deactivated;
    }
    {
      $("beep_on_error").checked = settings.beep_on_error;
    }
    renderPreview();
  }

  function openUserDataFolder() {
    console.log("Open user data folder");
    const xhttp = new XMLHttpRequest();
    xhttp.onload = function () {
      console.log("User data folder opened" + this.responseText);
    };
    xhttp.onerror = function () {
      console.error("Failed to open user data folder");
    };
    xhttp.open("GET", "/open_user_data_folder");
    xhttp.send();
  }

  function saveSettings(settings) {
    console.log("saving settings: " + settings);
    const xhttp = new XMLHttpRequest();
    xhttp.onload = function () {
      if (this.status >= 200 && this.status < 300) {
        showStatus("已儲存", false);
      } else {
        showStatus("儲存失敗", true);
      }
    };
    xhttp.onerror = function () {
      showStatus("儲存失敗", true);
    };
    xhttp.open("POST", "/config");
    const string = JSON.stringify(settings);
    xhttp.send(string);
    renderPreview();
  }

  (function () {
    const xhttp = new XMLHttpRequest();
    xhttp.onload = function () {
      try {
        settings = JSON.parse(this.responseText);
        if (settings == undefined) {
          settings = defaultSettings;
        }
        console.log("settings loaded: " + settings);
      } catch {
        settings = defaultSettings;
      }
      applySettings(settings);
    };
    xhttp.open("GET", "/config");
    xhttp.send("");
  })();

  $("use_mcbopomofo").onchange = (event) => {
    settings.input_mode = "use_mcbopomofo";
    saveSettings(settings);
  };

  $("use_plainbopomofo").onchange = (event) => {
    settings.input_mode = "use_plainbopomofo";
    saveSettings(settings);
  };

  $("font_size").onchange = (event) => {
    const value = +$("font_size").value;
    settings.candidate_font_size = value;
    saveSettings(settings);
  };

  $("font_name").onchange = (event) => {
    settings.candidate_font_name = $("font_name").value;
    saveSettings(settings);
  };

  $("layout_vertical").onchange = (event) => {
    settings.candidate_layout = "vertical";
    saveSettings(settings);
  };

  $("layout_horizontal").onchange = (event) => {
    settings.candidate_layout = "horizontal";
    saveSettings(settings);
  };

  $("layout").onchange = (event) => {
    const value = $("layout").value;
    settings.layout = value;
    saveSettings(settings);
  };

  $("keys").onchange = (event) => {
    const value = $("keys").value;
    settings.candidate_keys = value;
    saveSettings(settings);
  };

  $("keys_count").onchange = function (event) {
    const value = +$("keys_count").value;
    settings.candidate_keys_count = value;
    saveSettings(settings);
  };

  $("moving_cursor_option").onchange = function (event) {
    const value = +$("moving_cursor_option").value;
    settings.moving_cursor_option = value;
    saveSettings(settings);
  };

  $("before_cursor").onchange = (event) => {
    settings.select_phrase = "before_cursor";
    saveSettings(settings);
  };

  $("after_cursor").onchange = (event) => {
    settings.select_phrase = "after_cursor";
    saveSettings(settings);
  };

  $("esc_key").onchange = (event) => {
    const checked = $("esc_key").checked;
    settings.esc_key_clear_entire_buffer = checked;
    saveSettings(settings);
  };

  $("mixed_mode").onchange = (event) => {
    settings.mixed_mode = $("mixed_mode").checked;
    saveSettings(settings);
  };

  $("mixed_auto_space").onchange = (event) => {
    settings.mixed_auto_space = $("mixed_auto_space").checked;
    saveSettings(settings);
  };

  $("shift_key").onchange = (event) => {
    const checked = $("shift_key").checked;
    settings.shift_key_toggle_alphabet_mode = checked;
    saveSettings(settings);
  };

  $("uppercase_letters").onchange = (event) => {
    settings.letter_mode = "upper";
    saveSettings(settings);
  };

  $("lowercase_letters").onchange = (event) => {
    settings.letter_mode = "lower";
    saveSettings(settings);
  };

  $("move_cursor").onchange = (event) => {
    const checked = $("move_cursor").checked;
    settings.move_cursor = checked;
    saveSettings(settings);
  };

  $("by_default_deactivated").onchange = (event) => {
    const checked = $("by_default_deactivated").checked;
    settings.by_default_deactivated = checked;
    saveSettings(settings);
  };

  $("beep_on_error").onchange = (event) => {
    const checked = $("beep_on_error").checked;
    settings.beep_on_error = checked;
    saveSettings(settings);
  };

  $("allow_change_prior_tone").onchange = (event) => {
    const checked = $("allow_change_prior_tone").checked;
    settings.allow_changing_prior_tone = checked;
    saveSettings(settings);
  };

  $("repeated_punctuation_choose_candidate").onchange = (event) => {
    const checked = $("repeated_punctuation_choose_candidate").checked;
    settings.repeated_punctuation_choose_candidate = checked;
    saveSettings(settings);
  };

  $("open_data_folder").onclick = () => {
    openUserDataFolder();
    return false;
  };
};
