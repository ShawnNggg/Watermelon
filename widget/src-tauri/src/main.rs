// 常驻后台挂件：生产版不弹 Windows 控制台，macOS 走 LSUIElement 隐藏 Dock
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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
        .invoke_handler(tauri::generate_handler![set_widget_height])
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
