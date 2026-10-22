// Installer page logic. Talks to tools/installer/server.mjs; every step there is safe to repeat.
/* global jsQR */

const KEY = new URLSearchParams(location.search).get("k");
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fa = (n) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);

let S = {}; // last /api/state
let opened = null; // step the user opened by clicking its header
let telegramTimer = null;
let telegramStarted = 0;

async function api(name, body = {}) {
  let resp;
  try {
    resp = await fetch(`/api/${name}`, {
      method: "POST", headers: { "content-type": "application/json", "x-installer-key": KEY },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("ارتباط با برنامه‌ی نصب قطع شد. احتمالاً پنجره‌ی سیاه (ترمینال) بسته شده. " +
      "install.cmd را دوباره باز کن؛ کارهایی که انجام شده دوباره لازم نیست.");
  }
  if (resp.status === 403) throw new Error("این صفحه کهنه است. پنجره‌ای را که install.cmd باز کرد استفاده کن.");
  const data = await resp.json();
  if (data.error) throw new Error(data.error);
  return data;
}

/** Disable the button, show a spinner and a status line while `fn` runs; show errors in the step's message box. */
async function busy(button, text, fn) {
  const box = button.closest(".body");
  const msg = $(".msg", box) ?? box.appendChild(Object.assign(document.createElement("div"), { className: "msg" }));
  const label = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="spinner"></span>${esc(text)}`;
  msg.className = "msg info";
  msg.textContent = text;
  try {
    await fn(msg);
    msg.remove();
  } catch (err) {
    msg.className = "msg err";
    msg.textContent = err.message;
  } finally {
    button.disabled = false;
    button.innerHTML = label;
  }
}

// --- steps ----------------------------------------------------------------------------------------------------

const STEPS = [
  {
    id: "s1",
    done: () => S.cloudflare?.loggedIn && S.cloudflare.subdomain !== "",
    summary: () => (S.cloudflare?.loggedIn ? `<span class="ltr">${esc(S.cloudflare.email ?? "")}</span>` : ""),
    render(body) {
      const cf = S.cloudflare ?? {};
      if (!cf.loggedIn) {
        body.innerHTML = `
          <p>ربات روی سرورهای رایگان Cloudflare اجرا می‌شود، پس یک اکانت Cloudflare لازم داری (فقط ایمیل؛ کارت بانکی نمی‌خواهد).</p>
          <ol>
            <li>اگر اکانت نداری، <a href="https://dash.cloudflare.com/sign-up" target="_blank" rel="noopener">این‌جا ثبت‌نام کن</a> و ایمیلت را تأیید کن.</li>
            <li>دکمه‌ی زیر را بزن. یک صفحه‌ی Cloudflare باز می‌شود: وارد شو و دکمه‌ی <b>Allow</b> را بزن.</li>
            <li>بعد به همین صفحه برگرد؛ خودش ادامه می‌دهد.</li>
          </ol>
          <button id="cf-login">ورود به Cloudflare</button>
          <p class="hint">اگر چند دقیقه در صفحه‌ی Cloudflare کاری نکنی، زمانش تمام می‌شود؛ فقط دوباره همین دکمه را بزن.</p>`;
        $("#cf-login", body).onclick = (e) => busy(e.currentTarget, "منتظر تأیید در صفحه‌ی Cloudflare…", async () => {
          await api("cfLogin");
          await refresh();
        });
      } else if (cf.subdomain === "") {
        body.innerHTML = `
          <p>وارد شدی (<span class="ltr">${esc(cf.email)}</span>)، ولی اکانتت هنوز «زیردامنه‌ی workers.dev» ندارد.
            این فقط یک بار برای هر اکانت لازم است:</p>
          <ol>
            <li><a href="https://dash.cloudflare.com/?to=/:account/workers-and-pages" target="_blank" rel="noopener">این صفحه را باز کن</a>.</li>
            <li>اگر خواست یک اسم برای زیردامنه انتخاب کنی، یک اسم دلخواه انگلیسی بده و تأیید کن
              (یا از منوی Workers &amp; Pages ← Settings ← Subdomain).</li>
            <li>یک دقیقه صبر کن و دکمه‌ی زیر را بزن.</li>
          </ol>
          <button id="cf-check">دوباره بررسی کن</button>`;
        $("#cf-check", body).onclick = (e) => busy(e.currentTarget, "در حال بررسی…", refresh);
      } else {
        body.innerHTML = `
          <p>وارد اکانت Cloudflare شدی: <span class="ltr">${esc(cf.email)}</span>
            ${cf.subdomain ? `<br>آدرس‌های ربات‌هایت: <span class="ltr">*.${esc(cf.subdomain)}.workers.dev</span>` : ""}</p>
          <button class="secondary" id="cf-logout">می‌خواهم با اکانت دیگری وارد شوم</button>`;
        $("#cf-logout", body).onclick = (e) => busy(e.currentTarget, "خروج…", async () => {
          await api("cfLogout");
          opened = null;
          await refresh();
        });
      }
    },
  },
  {
    id: "s2",
    done: () => S.botSaved && !S.tokenRefused,
    summary: () => (S.bot ? `<span class="ltr">@${esc(S.bot)}</span>` : S.botSaved ? "ذخیره شد" : ""),
    render(body) {
      body.innerHTML = `
        ${S.tokenRefused ? `<div class="msg err">تلگرام توکن قبلی را قبول نکرد. توکن درست را دوباره وارد کن.</div>` : ""}
        <p>یک ربات تلگرام بساز:</p>
        <ol>
          <li>در تلگرام به <a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a> پیام بده و <code>/newbot</code> را بفرست.</li>
          <li>یک اسم برای ربات بفرست (هر چیزی، مثلاً «کورسز من»).</li>
          <li>یک نام کاربری انگلیسی بفرست که آخرش <code>bot</code> باشد (مثلاً <code>ali_courses_bot</code>).</li>
          <li>BotFather یک <b>توکن</b> می‌دهد، شبیه <code class="ltr">123456789:AAH…</code>. آن را کپی کن و این‌جا بگذار.</li>
        </ol>
        <label for="token">توکن ربات</label>
        <input type="password" id="token" autocomplete="off" spellcheck="false" placeholder="123456789:AA…">
        <label class="hint"><input type="checkbox" id="show"> نمایش توکن</label>
        <button id="bot-save">ذخیره و ادامه</button>`;
      $("#show", body).onchange = (e) => ($("#token", body).type = e.target.checked ? "text" : "password");
      $("#bot-save", body).onclick = (e) => busy(e.currentTarget, "بررسی توکن…", async () => {
        const res = await api("bot", { token: $("#token", body).value });
        S.tokenRefused = false;
        opened = null;
        if (res.unverified) sessionStorage.setItem("unverified", "1");
        await refresh();
      });
    },
  },
  {
    id: "s3",
    done: () => Boolean(S.workerUrl),
    summary: () => (S.workerUrl ? `<span class="ltr">${esc(S.workerUrl.replace("https://", ""))}</span>` : ""),
    render(body) {
      const unverified = sessionStorage.getItem("unverified");
      body.innerHTML = `
        ${unverified ? `<div class="msg info">از این کامپیوتر به تلگرام دسترسی نبود (روی اینترنت ایران فیلتر است)،
          برای همین توکن هنوز بررسی نشده. اشکالی ندارد: بعد از نصب، خود ربات از سمت Cloudflare بررسی‌اش می‌کند.</div>` : ""}
        <p>حالا ربات روی اکانت Cloudflare خودت ساخته می‌شود: یک دیتابیس کوچک و خود ربات. حدود یک دقیقه طول می‌کشد.</p>
        <button id="install">نصب ربات</button>
        <div class="log"></div>`;
      $("#install", body).onclick = (e) => busy(e.currentTarget, "در حال نصب… (حدود یک دقیقه)", async () => {
        const res = await api("install");
        $(".log", body).innerHTML = res.log.map(esc).join("<br>");
        opened = null;
        await refresh();
      });
    },
  },
  {
    id: "s4",
    done: () => Boolean(S.telegramOk && S.ownerClaimed),
    summary: () => (S.telegramOk && S.ownerClaimed ? "وصل شد" : ""),
    render(body) {
      if (!S.telegramOk) {
        body.innerHTML = `
          <p>حالا به تلگرام می‌گوییم پیام‌های رباتت را به Cloudflare بفرستد. لازم نیست کاری بکنی.</p>
          <div class="msg info" id="tg-status"><span class="spinner"></span>در حال وصل کردن…</div>`;
        startTelegram();
      } else {
        renderClaim(body);
      }
    },
  },
  {
    id: "s5",
    done: () => Boolean(S.moodleName),
    summary: () => (S.moodleName ? esc(S.moodleName) : ""),
    render(body) {
      body.innerHTML = `
        ${S.moodleName ? `<div class="msg ok">الان با حساب «${esc(S.moodleName)}» وصلی. اگر ربات گفت اتصال منقضی شده،
          همین مرحله را دوباره انجام بده.</div>` : ""}
        <ol>
          <li>روی <b>همین کامپیوتر</b> <a href="https://courses.aut.ac.ir/user/profile.php" target="_blank" rel="noopener">پروفایل کورسز</a>
            را باز کن و روی <b>«نمایش کد کیوآر»</b> بزن. اگر این صفحه از قبل باز بوده، اول رفرشش کن (F5) و اگر
            صفحه‌ی ورود آمد دوباره وارد شو: QR صفحه‌ای که از حسابش خارج شده‌ای کار نمی‌کند.</li>
          <li>از QR عکس بگیر: کلیدهای <b class="ltr">Win + Shift + S</b> را بزن و دور QR کادر بکش
            (یا روی QR راست‌کلیک کن و <b>Copy image</b> را بزن).</li>
          <li>به این صفحه برگرد، روی کادر زیر کلیک کن و <b class="ltr">Ctrl + V</b> بزن.</li>
        </ol>
        <div class="paste" tabindex="0" id="paste">این‌جا کلیک کن و <b class="ltr">Ctrl + V</b> بزن<br>
          <span class="hint">یا عکس QR را این‌جا بکش و رها کن، یا
          <label style="display:inline;font-weight:400"><u>فایل عکس را انتخاب کن</u><input type="file" accept="image/*" id="file" hidden></label></span></div>
        <p class="hint">هر QR فقط ۱۰ دقیقه و یک بار معتبر است؛ اگر خطا گرفتی، در کورسز یک QR تازه بساز.
          چون QR روی همین کامپیوتر خوانده می‌شود، مشکل «IP متفاوت» پیش نمی‌آید (فقط مرورگر و این برنامه هر دو با VPN یا هر دو بدون VPN باشند).</p>`;
      setupPaste(body);
    },
  },
  {
    id: "s6",
    done: () => false,
    summary: () => "",
    render(body) {
      const link = S.bot ? `<a href="https://t.me/${esc(S.bot)}" target="_blank" rel="noopener" class="ltr">@${esc(S.bot)}</a>` : "رباتت";
      body.innerHTML = `
        <div class="msg ok">ربات آماده است 🎉</div>
        <ol>
          <li>در تلگرام ${link} را باز کن و <code>/start</code> بزن.</li>
          <li>داخل هر درس دکمه‌ی <b>🔔 روشن کردن اعلان</b> را بزن تا محتوای جدیدش را خبر بدهد.</li>
          <li>هر چند ماه یک بار اتصال به کورسز منقضی می‌شود؛ ربات خودش خبر می‌دهد. آن موقع دوباره <b>install.cmd</b> را باز کن و فقط مرحله‌ی «ورود به کورسز» را انجام بده.</li>
        </ol>
        <p class="hint">ربات فقط به همان حساب تلگرامی جواب می‌دهد که در مرحله‌ی ۴ Start را زد.</p>
        <button class="secondary" id="quit">بستن نصب‌کننده</button>`;
      $("#quit", body).onclick = async () => {
        await api("quit").catch(() => {});
        document.body.innerHTML = `<main><h1>✅ تمام شد</h1><p>می‌توانی این صفحه و پنجره‌ی سیاه را ببندی.</p></main>`;
      };
    },
  },
];

function activeIndex() {
  if (opened !== null) return opened;
  const i = STEPS.findIndex((s) => !s.done());
  return i === -1 ? STEPS.length - 1 : i;
}

function render() {
  const active = activeIndex();
  STEPS.forEach((step, i) => {
    const section = document.getElementById(step.id);
    const done = step.done();
    section.classList.toggle("done", done);
    section.classList.toggle("active", i === active);
    $(".summary", section).innerHTML = done ? step.summary() : "";
    // Finished steps can be reopened (e.g. log in again, fix the token), but not ones still ahead.
    const reachable = done || i <= STEPS.findIndex((s) => !s.done());
    $("header", section).style.cursor = reachable ? "pointer" : "default";
    $("header", section).onclick = reachable && i !== active ? () => { opened = i; render(); } : null;
    if (i === active) step.render($(".body", section));
  });
  if (STEPS[active].id !== "s4") stopTelegram();
}

async function refresh() {
  S = { ...S, ...(await api("state")) };
  render();
}

// --- step 4: keep trying until Telegram accepts the webhook ----------------------------------------------------

function stopTelegram() {
  clearTimeout(telegramTimer);
  telegramTimer = null;
}

function startTelegram() {
  if (telegramTimer) return;
  telegramStarted ||= Date.now();
  const tick = async () => {
    const box = $("#tg-status");
    try {
      const res = await api("telegram");
      if (res.ok) {
        telegramStarted = 0;
        telegramTimer = null;
        opened = null;
        sessionStorage.removeItem("unverified");
        await refresh();
        return;
      }
      if (res.tokenRefused) {
        telegramTimer = null;
        S.tokenRefused = true;
        opened = 1;
        render();
        return;
      }
      const minutes = Math.floor((Date.now() - telegramStarted) / 60000);
      if (box) {
        box.innerHTML = `<span class="spinner"></span>آدرس ربات تازه ساخته شده و چند دقیقه طول می‌کشد تا تلگرام پیدایش کند.
          هر ۲۰ ثانیه خودم دوباره امتحان می‌کنم؛ لازم نیست کاری بکنی. معمولاً ۱ تا ۵ دقیقه، گاهی تا ۱۵ دقیقه.
          (${fa(minutes)} دقیقه گذشته)` + (minutes >= 20 ? `<br><br>بیش از حد معمول طول کشیده. وضعیت Cloudflare را در
          داشبورد چک کن، یا این صفحه را باز بگذار تا ادامه بدهم.` : "");
      }
    } catch (err) {
      if (box) {
        box.className = "msg err";
        box.textContent = err.message;
      }
    }
    telegramTimer = setTimeout(tick, 20_000);
  };
  telegramTimer = setTimeout(tick, 0);
}

// --- step 4b: the owner opens the bot through a one-time link, so the bot knows whom to serve ---------------------

let claim = null; // { app, web, command }, made once per page
let claimTimer = null;

async function renderClaim(body) {
  body.innerHTML = `<div class="msg info"><span class="spinner"></span>آماده کردن لینک…</div>`;
  try {
    claim ??= await api("claimLink");
  } catch (err) {
    body.innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
    return;
  }
  body.innerHTML = `
    <div class="msg ok">ربات به تلگرام وصل شد ✓</div>
    <p>یک قدم کوچک مانده: ربات باید بداند صاحبش تویی تا فقط به تو جواب بدهد.</p>
    <ol>
      <li>دکمه‌ی زیر را بزن تا رباتت در برنامه‌ی تلگرام باز شود.</li>
      <li>در تلگرام دکمه‌ی <b>Start</b> (یا «شروع») را بزن.</li>
    </ol>
    <a class="btn" href="${esc(claim.app)}">باز کردن ربات در تلگرام</a>
    <p class="hint">اگر تلگرام باز نشد: <a href="${esc(claim.web)}" target="_blank" rel="noopener">این لینک</a> را امتحان کن،
      یا رباتت (<span class="ltr">@${esc(S.bot)}</span>) را در تلگرام پیدا کن و این خط را برایش بفرست:</p>
    <p><code id="claim-cmd">${esc(claim.command)}</code> <button class="secondary" id="copy">کپی</button></p>
    <div class="msg info"><span class="spinner"></span>منتظرم در تلگرام Start را بزنی…</div>`;
  $("#copy", body).onclick = async (e) => {
    await navigator.clipboard.writeText(claim.command).catch(() => {});
    e.currentTarget.textContent = "کپی شد ✓";
  };
  clearTimeout(claimTimer);
  const poll = async () => {
    try {
      if ((await api("claimStatus")).claimed) {
        S.ownerClaimed = true;
        opened = null;
        await refresh();
        return;
      }
    } catch {
      // keep waiting; a network hiccup here is harmless
    }
    if ($("#claim-cmd")) claimTimer = setTimeout(poll, 5000);
  };
  claimTimer = setTimeout(poll, 5000);
}

// --- step 5: read the QR from a pasted/dropped image (or pasted text) ------------------------------------------

async function decodeQr(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const found = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  return found?.data ?? null;
}

function setupPaste(body) {
  const zone = $("#paste", body);
  const handle = async (file, text) => {
    const box = $(".msg.status", body) ?? zone.insertAdjacentElement("afterend",
      Object.assign(document.createElement("div"), { className: "msg info status" }));
    box.className = "msg info status";
    box.innerHTML = `<span class="spinner"></span>خواندن QR…`;
    try {
      const qr = file ? await decodeQr(file) : text?.trim();
      if (!qr) throw new Error("در این عکس QR پیدا نکردم. دوباره عکس بگیر و فقط خود QR را در کادر بگیر.");
      box.innerHTML = `<span class="spinner"></span>QR خوانده شد. در حال ورود به کورسز…`;
      const res = await api("login", { qr });
      S.moodleName = res.name;
      opened = null;
      await refresh();
    } catch (err) {
      box.className = "msg err status";
      box.textContent = err.message;
    }
  };
  pasteHandler = (e) => {
    e.preventDefault();
    const file = [...e.clipboardData.files].find((f) => f.type.startsWith("image/"));
    handle(file, file ? null : e.clipboardData.getData("text"));
  };
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("drag");
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
    if (file) handle(file);
  });
  $("#file", body).addEventListener("change", (e) => e.target.files[0] && handle(e.target.files[0]));
  zone.focus();
}

// Paste anywhere on the page (outside text fields) goes to the QR box while step 5 is open.
let pasteHandler = null;
document.addEventListener("paste", (e) => {
  if ($("#paste") && pasteHandler && !(document.activeElement instanceof HTMLInputElement)) pasteHandler(e);
});

refresh().catch((err) => {
  document.querySelector(".lead").insertAdjacentHTML("afterend", `<div class="msg err">${esc(err.message)}</div>`);
});
