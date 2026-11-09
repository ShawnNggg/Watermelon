// 常驻后台挂件：生产版不弹 Windows 控制台，macOS 走 LSUIElement 隐藏 Dock
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, Runtime,
};

// 内置小图标（1024×1024 瓜）→ 系统自动缩放
const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/icon.png");

fn main() {
    tauri::Builder::default()
        // 开机自启：macOS 用 LaunchAgent（不在"登录项"里露脸，纯后台）
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        // 自动更新：check → download_and_install → 自动重启
        // 签名密钥 + updater.endpoints 在 tauri.conf.json bundle.updater 里配
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // macOS：Accessory 模式 → 不占 Dock、不抢菜单栏，纯桌面挂件
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            setup_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_widget_height,
            grant_calendar_permission,
            get_calendar_events
        ])
        .run(tauri::generate_context!())
        .expect("error while running watermelon widget");
}

// 前端量出内容高度后调这里：窗口跟着内容长高，避免出现滚动条
#[tauri::command]
fn set_widget_height(window: tauri::WebviewWindow, height: f64) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let width = window
        .outer_size()
        .map(|s| s.width as f64 / scale)
        .unwrap_or(300.0);
    // 只在窗口可见时调整，避免隐藏时无谓的窗口操作
    if window.is_visible().unwrap_or(true) {
        let _ = window.set_size(tauri::LogicalSize::new(width, height));
    }
}

fn setup_tray<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(app, "hide", "隐藏窗口", true, None::<&str>)?;
    let update_item = MenuItem::with_id(app, "update", "检查更新…", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出 Watermelon", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &hide_item, &update_item, &quit_item])?;
    // 解码 PNG → RGBA → Tauri Image
    let decoder = png::Decoder::new(TRAY_ICON_BYTES);
    let mut reader = decoder.read_info().map_err(|e| tauri::Error::Anyhow(e.into()))?;
    let mut buf = vec![0u8; reader.output_buffer_size()];
    let frame = reader.next_frame(&mut buf).map_err(|e| tauri::Error::Anyhow(e.into()))?;
    let tray_icon = Image::new(&buf[..frame.buffer_size()], frame.width, frame.height);

    let _tray = TrayIconBuilder::with_id("main")
        .tooltip("下班啦 · Watermelon")
        .icon(tray_icon)
        .icon_as_template(true)
        .menu(&menu)
        // macOS 习惯：左键直接弹菜单，退出入口就在状态栏
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => toggle_window(app, true),
            "hide" => toggle_window(app, false),
            "update" => {
                // 让前端去跑 check → download → install 流程
                let _ = app.emit("wm:check-update", ());
                toggle_window(app, true);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

fn toggle_window<R: Runtime>(app: &tauri::AppHandle<R>, show: bool) {
    if let Some(w) = app.get_webview_window("main") {
        if show {
            let _ = w.show();
            let _ = w.set_focus();
        } else {
            let _ = w.hide();
        }
        // 通知前端：窗口显隐变化 → 决定是否继续跑渲染循环与动画
        let _ = app.emit("wm:visibility", show);
    }
}

/* ============== 本地日历读取（AppleScript → JSON）============== */

/// 返回 macOS 日历权限状态："granted" / "denied" / "prompt" / "unsupported"
#[tauri::command]
#[cfg(target_os = "macos")]
fn grant_calendar_permission() -> Result<String, String> {
    // 尝试用 osascript 触发权限弹窗 —— 第一次读日历就会弹
    let script = r#"
        tell application "Calendar"
            set calCount to count of calendars
        end tell
        return "ok:" & calCount
    "#;
    match Command::new("osascript").arg("-e").arg(script).output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if stdout.starts_with("ok:") {
                Ok("granted".to_string())
            } else {
                Ok("denied".to_string())
            }
        }
        Err(e) => Err(format!("osascript error: {}", e)),
    }
}

#[tauri::command]
#[cfg(not(target_os = "macos"))]
fn grant_calendar_permission() -> Result<String, String> {
    Ok("unsupported".to_string())
}

/// 读取给定日期范围内的日历事件（用于节假日/调休判定）
/// 传 start_date / end_date (YYYY-MM-DD)，返回 JSON 字符串：
/// [{"date":"2026-05-01","title":"劳动节","is_holiday":true,"source":"calendar"}, ...]
#[tauri::command]
#[cfg(target_os = "macos")]
fn get_calendar_events(start_date: String, end_date: String) -> Result<String, String> {
    // AppleScript 读 Calendar app 的事件 → 用 tab 分隔日期 / 标题 / 日历名
    // 我们在 Rust 里组装成 JSON
    // 把 YYYY-MM-DD 拆成 components，避免 AppleScript date 字符串在中文系统不认
    let sy: String = start_date.chars().take(4).collect();
    let sm: String = start_date.chars().skip(5).take(2).collect();
    let sd: String = start_date.chars().skip(8).take(2).collect();
    let ey: String = end_date.chars().take(4).collect();
    let em: String = end_date.chars().skip(5).take(2).collect();
    let ed: String = end_date.chars().skip(8).take(2).collect();

    let script = format!(
        r#"
        -- 安全构建日期（跨语言环境通用）
        set startDate to current date
        set year of startDate to {sy}
        set month of startDate to {sm}
        set day of startDate to {sd}
        set hours of startDate to 0
        set minutes of startDate to 0
        set seconds of startDate to 0

        set endDate to current date
        set year of endDate to {ey}
        set month of endDate to {em}
        set day of endDate to {ed}
        set hours of endDate to 0
        set minutes of endDate to 0
        set seconds of endDate to 0
        set endDate to endDate + (24 * 60 * 60) -- end_date 当天也要包含

        set output to ""
        tell application "Calendar"
            set allCals to every calendar
            repeat with cal in allCals
                set calName to name of cal
                try
                    set evs to (every event of cal whose start date >= startDate and start date < endDate)
                    repeat with ev in evs
                        set evStart to start date of ev
                        -- 直接拼 YYYY-MM-DD，不依赖系统地区
                        set yStr to (year of evStart) as string
                        set mStr to ((month of evStart) as integer) as string
                        if length of mStr is 1 then set mStr to "0" & mStr
                        set dStr to (day of evStart) as string
                        if length of dStr is 1 then set dStr to "0" & dStr
                        set evDate to yStr & "-" & mStr & "-" & dStr
                        set evTitle to summary of ev
                        set output to output & evDate & "|" & evTitle & "|" & calName & linefeed
                    end repeat
                end try
            end repeat
        end tell
        return output
        "#,
        sy = sy, sm = sm, sd = sd, ey = ey, em = em, ed = ed
    );

    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("osascript exec error: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // 用户没授权 —— 这时候前端应该请求权限
        if stderr.contains("not authorized") || stderr.contains("不允许") {
            return Err("permission_denied".to_string());
        }
        return Err(format!("osascript error: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let lines: Vec<&str> = stdout.lines().filter(|l| !l.is_empty()).collect();

    // 组装 JSON（手动拼比引 serde 更轻量，且不需要依赖）
    let mut json_arr = String::from("[");
    let mut first = true;
    for line in lines {
        let parts: Vec<&str> = line.splitn(3, '|').collect();
        if parts.len() < 3 { continue; }
        let date_str = normalize_apple_date(parts[0]);
        let title = parts[1].replace('"', "\\\"");
        let cal_name = parts[2].replace('"', "\\\"");

        if !first { json_arr.push(','); }
        json_arr.push_str(&format!(
            "{{\"date\":\"{}\",\"title\":\"{}\",\"calendar\":\"{}\"}}",
            date_str, title, cal_name
        ));
        first = false;
    }
    json_arr.push(']');

    Ok(json_arr)
}

#[tauri::command]
#[cfg(not(target_os = "macos"))]
fn get_calendar_events(_start_date: String, _end_date: String) -> Result<String, String> {
    Ok("[]".to_string())
}

/// AppleScript 返回的日期字符串 → YYYY-MM-DD
/// macOS 中文系统 osascript 会返回 "2026年5月1日 星期四 00:00:00"
/// 英文系统返回 "Thursday, May 1, 2026 at 00:00:00"
/// 我们正则提取第一个 4 位数年份 + 月日
fn normalize_apple_date(raw: &str) -> String {
    use regex::Regex;
    // 先试 "2026年5月1日"
    if let Ok(re) = Regex::new(r"(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日") {
        if let Some(cap) = re.captures(raw) {
            return format!("{}-{:02}-{:02}", &cap[1], cap[2].parse::<u32>().unwrap_or(1), cap[3].parse::<u32>().unwrap_or(1));
        }
    }
    // 再试 "2026-05-01" 或 "2026/5/1"
    if let Ok(re) = Regex::new(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})") {
        if let Some(cap) = re.captures(raw) {
            return format!("{}-{:02}-{:02}", &cap[1], cap[2].parse::<u32>().unwrap_or(1), cap[3].parse::<u32>().unwrap_or(1));
        }
    }
    raw.to_string()
}
