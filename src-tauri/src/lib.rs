use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let sidecar = app
                .shell()
                .sidecar("mechvis-backend")
                .expect("failed to create sidecar command");

            let (mut rx, _child) = sidecar
                .spawn()
                .expect("failed to start Python sidecar");

            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            println!(
                                "[python] {}",
                                String::from_utf8_lossy(&line)
                            );
                        }

                        CommandEvent::Stderr(line) => {
                            eprintln!(
                                "[python error] {}",
                                String::from_utf8_lossy(&line)
                            );
                        }

                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}