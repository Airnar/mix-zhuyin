window.onload = () => {
  const $ = (id) => document.getElementById(id);

  let statusTimer = undefined;
  function showStatus(message, isError) {
    const status = $("save_status");
    status.textContent = message;
    status.classList.toggle("error", isError);
    status.classList.add("visible");
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => status.classList.remove("visible"), 1600);
  }

  function request(method, url, body, onDone) {
    const xhttp = new XMLHttpRequest();
    xhttp.onload = function () {
      onDone(this.status >= 200 && this.status < 300, this.responseText);
    };
    xhttp.onerror = function () {
      onDone(false, "");
    };
    xhttp.open(method, url);
    xhttp.send(body);
  }

  function load() {
    request("GET", "/snippets", "", (ok, text) => {
      if (ok) {
        $("snippets").value = text;
      } else {
        showStatus("讀取失敗", true);
      }
    });
  }

  $("save").onclick = () => {
    let text = $("snippets").value;
    if (text.length > 0 && !text.endsWith("\n")) {
      text += "\n";
    }
    request("POST", "/snippets", text, (ok) => {
      showStatus(ok ? "已儲存" : "儲存失敗", !ok);
    });
  };
  $("reload").onclick = load;
  $("open").onclick = () => {
    request("GET", "/open_snippets", "", (ok) => {
      if (!ok) {
        showStatus("無法打開", true);
      }
    });
  };
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "s") {
      event.preventDefault();
      $("save").click();
    }
  });

  load();
};
