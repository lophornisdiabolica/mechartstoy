// The desktop app is a window around the same web build (`npm run build`
// puts it in dist/). Nothing here changes how the game plays.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running the Mech Battle app");
}
