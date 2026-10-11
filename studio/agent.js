"use strict";

// "Design with AI": a chat panel on the stage. The user signs in with Google, describes the
// station, and the assistant (agent-worker/) builds or edits it with the same station tools
// ChatGPT uses. The result is applied like any other edit, so Ctrl+Z undoes it.
(function () {
  const cfg = window.IOLINKI_AGENT || {};
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const params = new URLSearchParams(location.search);
  // Local dev can point at a local Worker or a test client ID; the live site cannot.
  const api = String((local && params.get("agentApi")) || cfg.api || "").replace(/\/$/, "");
  const clientId = (local && params.get("agentClient")) || cfg.googleClientId || "";
  const KEY = "iolinki.agent.session";
  const SAMPLES = [
    "Pump pressure, switch at 40 bar, and a tank level sensor",
    "Detect stainless parts at 3 mm and count boxes on a conveyor",
    "Coolant flow with an alarm below 30 %",
  ];
  const ai = { session: readSession(), log: [], busy: false, open: false, notice: "", gsi: false };

  function readSession() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "null");
      return saved && saved.token && saved.expires * 1000 > Date.now() ? saved : null;
    } catch (error) {
      return null;
    }
  }

  function keepSession(session) {
    ai.session = session;
    try {
      session ? localStorage.setItem(KEY, JSON.stringify(session)) : localStorage.removeItem(KEY);
    } catch (error) {
      // Private mode: the session lives until the page closes.
    }
  }

  const panel = $("#ai-panel");
  const body = $("#ai-body");
  const input = $("#ai-input");

  function setOpen(open) {
    ai.open = open;
    panel.hidden = !open;
    $("#ai-open").setAttribute("aria-expanded", String(open));
    $("#ai-open").classList.toggle("on", open);
    // The start card would sit behind the panel.
    $(".stage").classList.toggle("ai-on", open);
    if (open) {
      draw();
      if (ai.session) {
        input.focus();
      }
    }
  }

  function quotaText() {
    const s = ai.session;
    return s && s.remaining !== undefined && s.remaining !== null ? s.remaining + " of " + s.limit + " messages left today" : "";
  }

  function stepText(step) {
    return escapeText(step.ok ? step.summary : "A step failed and was retried");
  }

  function draw() {
    const signedIn = Boolean(ai.session);
    panel.classList.toggle("signedin", signedIn);
    $("#ai-form").hidden = !signedIn;
    $("#ai-foot").hidden = !signedIn;
    if (!signedIn) {
      drawGate();
      return;
    }
    $("#ai-foot").innerHTML = "<span>" + escapeText(ai.session.user.email) + " · " + escapeText(quotaText()) + "</span><button type=\"button\" id=\"ai-out\">Sign out</button>";
    $("#ai-out").addEventListener("click", signOut);
    if (!ai.log.length) {
      body.innerHTML = "<div class=\"ai-hello\"><p>Describe what the station has to sense. I pick the sensors from the datasheet library, place them and wire each one to a master port. Then ask for changes.</p><div class=\"ai-samples\">" +
        SAMPLES.map((text) => "<button type=\"button\">" + escapeText(text) + "</button>").join("") + "</div></div>";
      body.querySelectorAll(".ai-samples button").forEach((button) => button.addEventListener("click", () => send(button.textContent)));
      return;
    }
    body.innerHTML = ai.log.map((entry) => {
      if (entry.role === "user") {
        return "<div class=\"ai-msg user\">" + escapeText(entry.content) + "</div>";
      }
      const steps = (entry.steps || []).length ? "<div class=\"ai-steps\">" + entry.steps.map((step) => "<span class=\"" + (step.ok ? "" : "bad") + "\">" + stepText(step) + "</span>").join("") + "</div>" : "";
      const applied = entry.applied ? "<div class=\"ai-applied\">Applied to the studio · Ctrl+Z undoes</div>" : "";
      return "<div class=\"ai-msg bot" + (entry.error ? " err" : "") + "\">" + escapeText(entry.content) + steps + applied + "</div>";
    }).join("") + (ai.busy ? "<div class=\"ai-msg bot working\"><span class=\"dots\"><i></i><i></i><i></i></span> Choosing sensors and wiring the station</div>" : "");
    body.scrollTop = body.scrollHeight;
    $("#ai-send").disabled = ai.busy;
  }

  function drawGate() {
    let action;
    if (!clientId) {
      action = "<p class=\"muted\">Sign-in is not set up on this site yet.</p>";
    } else {
      action = "<div id=\"ai-gsi\" class=\"ai-gsi\"></div><p class=\"muted\" id=\"ai-gsi-note\"></p>";
    }
    body.innerHTML = "<div class=\"ai-gate\"><h3>Describe it, and it gets built</h3><p>The assistant turns a description such as <em>pump pressure, switch at 40 bar</em> into a checked, wired station. Sign in with Google to use it. It runs on paid model credits, so it is limited to a few dozen messages a day per person.</p>" +
      action + "<p class=\"muted\">Looking around and building by hand stay open to everyone, no account needed.</p>" +
      (ai.notice ? "<p class=\"no\">" + escapeText(ai.notice) + "</p>" : "") + "</div>";
    if (clientId) {
      mountGoogleButton();
    }
  }

  function loadGoogle() {
    if (window.google && window.google.accounts && window.google.accounts.id) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Google sign-in could not load. Check your connection or content blocker."));
      document.head.appendChild(script);
    });
  }

  function mountGoogleButton() {
    loadGoogle().then(() => {
      const target = $("#ai-gsi");
      if (!target) {
        return;
      }
      if (!ai.gsi) {
        window.google.accounts.id.initialize({ client_id: clientId, callback: onCredential, ux_mode: "popup", auto_select: false });
        ai.gsi = true;
      }
      window.google.accounts.id.renderButton(target, { theme: "outline", size: "large", shape: "pill", text: "signin_with", logo_alignment: "left", width: 260 });
    }, (error) => {
      const note = $("#ai-gsi-note");
      if (note) {
        note.innerHTML = "<span class=\"no\">" + escapeText(error.message) + "</span>";
      }
    });
  }

  function onCredential(response) {
    ai.notice = "";
    fetch(api + "/auth/google", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential: response.credential }) })
      .then((reply) => reply.json().then((data) => ({ ok: reply.ok, data: data })))
      .then(({ ok, data }) => {
        if (!ok) {
          throw new Error(data.error || "Sign-in failed.");
        }
        keepSession({ token: data.token, expires: data.expires, user: data.user, limit: data.limit, remaining: data.remaining });
        draw();
        input.focus();
      })
      .catch((error) => {
        ai.notice = error.message === "Failed to fetch" ? "The assistant service could not be reached." : error.message;
        draw();
      });
  }

  function signOut() {
    keepSession(null);
    ai.log = [];
    ai.notice = "";
    if (window.google && window.google.accounts) {
      window.google.accounts.id.disableAutoSelect();
    }
    draw();
  }

  // Apply the assistant's station like any other edit (one undo step).
  function apply(station) {
    (station.extra_parts || []).forEach((def) => {
      if (def && def.id && !byId(library, def.id)) {
        library.sensors.push(def);
      }
    });
    const built = fromDiagram({ parts: station.diagram.parts, wires: station.diagram.wires }, library);
    view.station = built.station;
    view.selected = null;
    changed();
    drawLibrary();
    const s3d = $("#scene").s3d;
    if (s3d) {
      s3d.fit();
    }
  }

  function send(text) {
    text = String(text || "").trim();
    if (!text || ai.busy || !ai.session) {
      return;
    }
    ai.log.push({ role: "user", content: text });
    ai.busy = true;
    input.value = "";
    input.style.height = "";
    draw();
    const messages = ai.log.filter((entry) => !entry.error).map((entry) => ({ role: entry.role, content: entry.content }));
    const diagram = view.station.items.length ? toDiagram(view.station, library) : null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 130000);
    fetch(api + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + ai.session.token },
      body: JSON.stringify({ messages: messages, diagram: diagram }),
      signal: controller.signal,
    }).then((reply) => reply.json().catch(() => ({})).then((data) => ({ status: reply.status, data: data })))
      .then(({ status, data }) => {
        if (status === 401) {
          keepSession(null);
          ai.notice = "Your sign-in expired. Sign in again to continue.";
          ai.log.pop();
          return;
        }
        if (status !== 200) {
          ai.log.push({ role: "assistant", content: data.error || "The assistant could not answer. Try again.", error: true });
          if (status === 429 && data.code === "quota") {
            ai.session.remaining = 0;
            keepSession(ai.session);
          }
          return;
        }
        let applied = false;
        if (data.station && data.station.diagram) {
          try {
            apply(data.station);
            applied = true;
          } catch (error) {
            data.reply += " (The station could not be shown: " + error.message + ")";
          }
        }
        ai.session.remaining = data.remaining;
        ai.session.limit = data.limit;
        keepSession(ai.session);
        ai.log.push({ role: "assistant", content: data.reply, steps: data.steps, applied: applied });
      })
      .catch((error) => {
        ai.log.push({ role: "assistant", content: error.name === "AbortError" ? "That took too long. Try a shorter request." : "The assistant could not be reached. Try again.", error: true });
      })
      .finally(() => {
        clearTimeout(timer);
        ai.busy = false;
        draw();
        if (ai.session) {
          input.focus();
        }
      });
  }

  $("#ai-open").addEventListener("click", () => setOpen(!ai.open));
  $("#ai-close").addEventListener("click", () => setOpen(false));
  document.querySelectorAll("[data-open-ai]").forEach((button) => button.addEventListener("click", () => setOpen(true)));
  $("#ai-form").addEventListener("submit", (event) => {
    event.preventDefault();
    send(input.value);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send(input.value);
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
    input.style.overflowY = input.scrollHeight > 120 ? "auto" : "hidden";
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      $("#ai-open").focus();
    }
  });
  if (params.get("ai") === "1") {
    setOpen(true);
  }
})();
