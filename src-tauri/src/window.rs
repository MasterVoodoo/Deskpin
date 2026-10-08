use std::path::PathBuf;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, WebviewWindow, Window, WindowEvent};
#[cfg(not(debug_assertions))]
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[derive(Clone, Copy, PartialEq)]
pub enum Mode {
    Top,
    Desktop,
}

impl Mode {
    fn as_str(self) -> &'static str {
        match self {
            Mode::Top => "top",
            Mode::Desktop => "desktop",
        }
    }

    fn toggled(self) -> Mode {
        match self {
            Mode::Top => Mode::Desktop,
            Mode::Desktop => Mode::Top,
        }
    }
}

pub struct ModeState(Mutex<Mode>);

impl Default for ModeState {
    fn default() -> Self {
        ModeState(Mutex::new(Mode::Top))
    }
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

fn mode_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("mode.txt"))
}

fn current_mode(app: &AppHandle) -> Mode {
    *app.state::<ModeState>().0.lock().unwrap()
}

fn apply_mode(app: &AppHandle, mode: Mode) {
    if let Some(w) = main_window(app) {
        let _ = w.set_always_on_top(mode == Mode::Top);
        #[cfg(windows)]
        let _ = win32::set_desktop_owner(&w, mode == Mode::Desktop);
    }
    *app.state::<ModeState>().0.lock().unwrap() = mode;
    if let Some(path) = mode_file(app) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(path, mode.as_str());
    }
    let _ = app.emit("mode", mode.as_str());
}

fn toggle_mode_inner(app: &AppHandle) -> Mode {
    let mode = current_mode(app).toggled();
    apply_mode(app, mode);
    mode
}

fn set_visible(app: &AppHandle, visible: bool) {
    let Some(w) = main_window(app) else { return };
    if visible {
        let _ = w.show();
        let _ = w.set_focus();
    } else {
        let _ = w.hide();
    }
    let _ = app.emit("visibility", visible);
}

fn toggle_visible(app: &AppHandle) {
    let visible = main_window(app).and_then(|w| w.is_visible().ok()).unwrap_or(false);
    set_visible(app, !visible);
}

#[tauri::command]
pub fn toggle_mode(app: AppHandle) -> String {
    toggle_mode_inner(&app).as_str().into()
}

#[tauri::command]
pub fn get_mode(app: AppHandle) -> String {
    current_mode(&app).as_str().into()
}

#[tauri::command]
pub fn hide_window(app: AppHandle) {
    set_visible(&app, false);
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    let app = window.app_handle();
    match event {
        // Close = hide to tray; quitting is only from the tray menu.
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            set_visible(app, false);
        }
        // In desktop mode, drop back behind other windows once the user clicks away.
        #[cfg(windows)]
        WindowEvent::Focused(false) if current_mode(app) == Mode::Desktop => {
            if let Some(w) = main_window(app) {
                let _ = win32::send_to_bottom(&w);
            }
        }
        _ => {}
    }
}

pub fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();

    let saved = mode_file(&handle).and_then(|p| std::fs::read_to_string(p).ok());
    let mode = if saved.as_deref().map(str::trim) == Some("desktop") { Mode::Desktop } else { Mode::Top };
    apply_mode(&handle, mode);

    let toggle = MenuItem::with_id(app, "toggle", "Show / hide", true, None::<&str>)?;
    let pin = MenuItem::with_id(app, "mode", "Toggle pin mode", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit deskpin", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &pin, &quit])?;
    TrayIconBuilder::new()
        .icon(app.default_window_icon().cloned().ok_or("missing app icon")?)
        .tooltip("deskpin")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => toggle_visible(app),
            "mode" => {
                toggle_mode_inner(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_visible(tray.app_handle());
            }
        })
        .build(app)?;

    // Ctrl+Alt+Space is commonly owned by other apps (e.g. launchers), so show/hide uses Ctrl+Alt+D.
    let show_hide = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyD);
    let pin_mode = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyP);
    let (h_show, h_pin) = (show_hide.clone(), pin_mode.clone());
    app.handle().plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                if event.state() != ShortcutState::Pressed {
                    return;
                }
                if shortcut == &h_show {
                    toggle_visible(app);
                } else if shortcut == &h_pin {
                    toggle_mode_inner(app);
                }
            })
            .build(),
    )?;
    // A hotkey another app already owns must not stop the widget from starting.
    for shortcut in [show_hide, pin_mode] {
        if let Err(e) = app.global_shortcut().register(shortcut) {
            eprintln!("deskpin: could not register hotkey: {e}");
        }
    }

    // Only installed (release) builds start at login; dev runs must not register themselves.
    #[cfg(not(debug_assertions))]
    let _ = app.autolaunch().enable();
    Ok(())
}

#[cfg(windows)]
mod win32 {
    use tauri::WebviewWindow;
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        FindWindowW, SetWindowLongPtrW, SetWindowPos, GWLP_HWNDPARENT, HWND_BOTTOM, SWP_NOACTIVATE,
        SWP_NOMOVE, SWP_NOSIZE,
    };

    fn hwnd(win: &WebviewWindow) -> tauri::Result<HWND> {
        Ok(HWND(win.hwnd()?.0 as _))
    }

    /// Owning the window by Progman (the desktop) keeps it visible through Win+D, like a classic
    /// desktop gadget. Owner, not child re-parenting: a re-parented WebView2 loses input.
    pub fn set_desktop_owner(win: &WebviewWindow, on: bool) -> tauri::Result<()> {
        let owner = if on {
            unsafe { FindWindowW(w!("Progman"), PCWSTR::null()) }.unwrap_or_default()
        } else {
            HWND::default()
        };
        unsafe { SetWindowLongPtrW(hwnd(win)?, GWLP_HWNDPARENT, owner.0 as isize) };
        if on {
            send_to_bottom(win)?;
        }
        Ok(())
    }

    pub fn send_to_bottom(win: &WebviewWindow) -> tauri::Result<()> {
        unsafe {
            let _ = SetWindowPos(hwnd(win)?, Some(HWND_BOTTOM), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
        Ok(())
    }
}
